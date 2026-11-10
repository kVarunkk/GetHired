import { reportError } from "@/helpers/posthog/report-error";
import { RelevantProfilesUpdateEmail } from "@/emails/RelevantProfilesUpdateEmail";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { deploymentUrl, INTERNAL_API_SECRET } from "@/utils/formatters";
import { AllProfileWithRelations, ProfileMatchScores } from "@/utils/types";
import { render } from "react-email";
import { headers } from "next/headers";
import { enqueueTopExplanations } from "@/helpers/matching/enqueue-explanations";
import { transition, transitionMany } from "@/helpers/db/transition";

const URL = deploymentUrl();

/** jev's 0–4 aggregate as a 0–100 match score (MT-ASSUMPTION-001). */
const toMatchScore = (aggregate: number) =>
  Math.min(100, Math.max(0, Math.round((aggregate / 4) * 100)));

const round2 = (n: number) => Math.round(n * 100) / 100;

export const sendEmailForRelevantProfilesStatusUpdate = async (
  email: string,
  name: string,
  jobName: string,
  url: string,
  status: "success" | "failure",
  error?: string,
) => {
  try {
    const emailHtml = await render(
      <RelevantProfilesUpdateEmail
        userName={name}
        jobName={jobName}
        inviteUrl={url}
        status={status}
        error={error}
      />,
    );

    const emailText = await render(
      <RelevantProfilesUpdateEmail
        userName={name}
        jobName={jobName}
        inviteUrl={url}
        status={status}
        error={error}
      />,
      {
        plainText: true,
      },
    );

    sendEmail({
      toEmail: email,
      subject: `Important: Your AI Smart Search Profile Feed for ${jobName} is ready!`,
      htmlContent: emailHtml,
      textContent: emailText,
    });
  } catch {
    reportError(
      "Some error occured while sending status update email to " +
        email +
        "for relevant profile update.",
    );
  }
};

/**
 * Rebuilds a job's stored candidate matches and moves the job from `progress`
 * to `completed`. A failure is returned, not written: the caller decides
 * whether to retry or give up (SM-REQ-013).
 */
export async function processJobPostingRelevance(
  userId: string,
  jobPostingId: string,
  isInternalCall: boolean = false,
) {
  const supabase = isInternalCall
    ? createServiceRoleClient()
    : await createClient();

  try {
    // userId is the company's owner (RelevanceProfilesMessage), and
    // company_info.user_id means "owner" (TM-CON-001), so this stays on user_id.
    const { data: companyData, error: companyError } = await supabase
      .from("company_info")
      .select("id, name, email")
      .eq("user_id", userId)
      .single();

    if (!companyData || companyError)
      throw new Error(companyError.message || "Company user not found.");

    const { data: jobPostingsData, error: jobPostingsError } = await supabase
      .from("job_postings")
      .select("title")
      .eq("id", jobPostingId)
      .single();

    if (!jobPostingsData || jobPostingsError)
      throw new Error(
        jobPostingsError.message || "Job posting data not found.",
      );

    const headersList = await headers();
    const cookie = headersList.get("Cookie");
    const requestHeaders: Record<string, string> = {};
    if (isInternalCall) {
      requestHeaders["X-Internal-Secret"] = INTERNAL_API_SECRET;
    } else if (cookie) {
      requestHeaders["Cookie"] = cookie;
    }
    const response = await fetch(
      `${URL}/api/profiles?sortBy=relevance&job_post=${jobPostingId}&userId=${userId}&type=digest`,
      {
        headers: requestHeaders,
      },
    );

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        `Failed to fetch relevant profiles (${response.status}): ${body?.error ?? response.statusText}`,
      );
    }

    const json = await response.json();
    const profiles: AllProfileWithRelations[] = json.data || [];
    const matchScores: Record<string, ProfileMatchScores> =
      json.matchScores || {};

    // The caller has checked the job is this company's. Rows are written with
    // the service role: company users have no UPDATE policy here, so they
    // can't set scores or explanations themselves (MT-REQ-001).
    const admin = createServiceRoleClient();

    const { data: existingRows, error: existingError } = await admin
      .from("job_relevant_profiles")
      .select("user_id, match_score, explanation_status")
      .eq("job_posting_id", jobPostingId);

    if (existingError)
      throw new Error(`Load failed: ${existingError.message}`);

    const existing = new Map(
      (existingRows ?? []).map((row) => [row.user_id, row]),
    );
    const now = new Date().toISOString();

    // Upsert rather than delete-and-insert, so cached explanations survive a
    // re-run (MT-REQ-003). Neither `explanation` nor `explanation_status` is
    // in the payload: a new row gets `none`, and an existing one keeps its
    // state, which a worker may be changing meanwhile (SM-REQ-001). The
    // statuses worked out here only pick what to mark stale and enqueue.
    const ranked = profiles.map((profile, index) => {
      const score = matchScores[profile.user_id];
      const matchScore = score ? toMatchScore(score.aggregate) : null;
      const previous = existing.get(profile.user_id);
      const explanationStatus = !previous
        ? "none"
        : previous.explanation_status === "completed" &&
            previous.match_score !== matchScore
          ? "stale"
          : previous.explanation_status;

      return {
        row: {
          job_posting_id: jobPostingId,
          user_id: profile.user_id,
          relevance_rank: index + 1,
          match_score: matchScore,
          skills_score: score ? round2(score.skills) : null,
          experience_score: score ? round2(score.experience) : null,
          preference_conflict: score ? round2(score.preferenceConflict) : null,
          updated_at: now,
        },
        explanation_status: explanationStatus,
        madeStale: previous?.explanation_status === "completed" && explanationStatus === "stale",
      };
    });
    const rowsToUpsert = ranked.map((entry) => entry.row);

    if (rowsToUpsert.length > 0) {
      const { error: upsertError } = await admin
        .from("job_relevant_profiles")
        .upsert(rowsToUpsert, { onConflict: "job_posting_id,user_id" });

      if (upsertError) throw new Error(`Upsert failed: ${upsertError.message}`);
    }

    // A changed score makes a stored explanation out of date: from
    // `completed` only.
    const madeStale = ranked.filter((entry) => entry.madeStale).map((entry) => entry.row.user_id);
    if (madeStale.length > 0) {
      await transitionMany(
        admin,
        "job_relevant_profiles",
        { key: "user_id", ids: madeStale, match: { job_posting_id: jobPostingId }, column: "explanation_status" },
        { from: ["completed"], to: "stale" },
      );
    }

    // Remove candidates who no longer match.
    let staleQuery = admin
      .from("job_relevant_profiles")
      .delete()
      .eq("job_posting_id", jobPostingId);
    if (rowsToUpsert.length > 0) {
      staleQuery = staleQuery.not(
        "user_id",
        "in",
        `(${rowsToUpsert.map((row) => row.user_id).join(",")})`,
      );
    }
    const { error: deleteError } = await staleQuery;

    if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`);

    // Background "why" for the top candidates. Never fails the digest:
    // anything not queued can still be explained on demand.
    try {
      await enqueueTopExplanations(
        admin,
        jobPostingId,
        ranked.map((entry) => ({ user_id: entry.row.user_id, explanation_status: entry.explanation_status })),
      );
    } catch (err) {
      reportError("[relevant profiles] couldn't queue explanations", err);
    }

    // From `progress` only (SM-REQ-013): a job that left it (e.g. a give-up
    // written meanwhile) isn't this run's to finish, and gets no email.
    const { applied } = await transition(
      supabase,
      "job_postings",
      { id: jobPostingId, column: "matching_status" },
      {
        from: ["progress"],
        to: "completed",
        patch: { matching_error: null, matched_at: new Date().toISOString() },
      },
    );
    if (!applied) return { success: true };

    await sendEmailForRelevantProfilesStatusUpdate(
      companyData.email!,
      companyData?.name || "",
      jobPostingsData?.title || "",
      URL + "/company/profiles?sortBy=relevance&job_post=" + jobPostingId,
      "success",
    );

    return { success: true };
  } catch (error) {
    // The worker retries and, on its last attempt, writes `failed` and emails
    // the admin (SM-REQ-013), so a failed attempt leaves the job in progress.
    reportError("[relevant profiles] update failed", error);
    const msg =
      error instanceof Error ? error.message : "Unknown error occured.";
    return {
      success: false,
      error: msg,
    };
  }
}
