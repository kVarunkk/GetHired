import { reportError } from "@/helpers/posthog/report-error";
import { render } from "react-email";
import RelevantJobsSetupUpdateEmail from "@/emails/RelevantJobsSetupUpdateEmail";
import { sendEmail } from "@/utils/email";
import { transitionMany } from "@/helpers/db/transition";
import { AllJobWithRelations, TAICredits } from "@/utils/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { deploymentUrl, INTERNAL_API_SECRET } from "@/utils/formatters";

const URL = deploymentUrl();

export const sendEmailForRelevantJobsStatusUpdate = async (
  email: string,
  name: string,
  url: string,
  insufficientCredits = false,
) => {
  try {
    const emailHtml = await render(
      <RelevantJobsSetupUpdateEmail
        userName={name}
        inviteUrl={url}
        insufficientCredits={insufficientCredits}
      />,
    );

    const emailText = await render(
      <RelevantJobsSetupUpdateEmail
        userName={name}
        inviteUrl={url}
        insufficientCredits={insufficientCredits}
      />,
      {
        plainText: true,
      },
    );

    sendEmail({
      toEmail: email,
      subject: `Important: Your AI Smart Search Job Feed is ready!`,
      htmlContent: emailHtml,
      textContent: emailText,
    });
  } catch {
    reportError(
      "Some error occured while sending status update email to Varun Kumawat",
    );
  }
};

/**
 * Rebuilds the user's stored feed (user_relevant_jobs) and marks it completed.
 * A failure is returned, not written: the calling worker retries and writes
 * `failed` (and emails the admin) only when it gives up (SM-REQ-013).
 */
export async function processUserRelevance(
  userId: string,
  isInternalCall: boolean = false,
) {
  const supabase = isInternalCall
    ? createServiceRoleClient()
    : await createClient();

  try {
    const { data, error } = await supabase
      .from("user_info")
      .select("email, full_name, ai_credits")
      .eq("user_id", userId)
      .single();

    if (!data || error) {
      throw new Error(error.message || "User not found.");
    }

    const insufficientCredits =
      (data.ai_credits || 0) < TAICredits.AI_SEARCH_ASK_AI_RESUME;

    if (!insufficientCredits) {
      const headersList = await headers();
      const cookie = headersList.get("Cookie");

      const requestHeaders: Record<string, string> = {};
      if (isInternalCall) {
        requestHeaders["X-Internal-Secret"] = INTERNAL_API_SECRET;
      } else if (cookie) {
        requestHeaders["Cookie"] = cookie;
      }

      const response = await fetch(
        `${URL}/api/jobs?sortBy=relevance&limit=100&createdAfter=30&userId=${userId}`,
        {
          cache: "no-cache",
          headers: requestHeaders,
        },
      );

      if (!response.ok) throw new Error(`Jobs API returned ${response.status}`);

      const json = await response.json();
      const jobs: AllJobWithRelations[] = json.data || [];

      const rowsToInsert = jobs.map((job, index) => ({
        user_id: userId,
        jobs_id: job.id,
        relevance_rank: index + 1,
        updated_at: new Date().toISOString(),
      }));

      const { error: deleteError } = await supabase
        .from("user_relevant_jobs")
        .delete()
        .eq("user_id", userId);

      if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`);

      if (rowsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from("user_relevant_jobs")
          .insert(rowsToInsert);

        if (insertError)
          throw new Error(`Insert failed: ${insertError.message}`);
      }
    }

    // This runs even if the user has insufficient AI credits. From every
    // state: the daily cron (relevant-jobs/enqueue) queues users without
    // marking them `progress`, so a cron run must still land on a `completed`
    // or `failed` feed.
    await transitionMany(
      supabase,
      "user_info",
      { key: "user_id", ids: [userId], column: "relevant_jobs_update_status" },
      {
        from: ["pending", "progress", "failed", "completed"],
        to: "completed",
        patch: { updated_at: new Date().toISOString() },
      },
    );

    // email to user in case of success

    await sendEmailForRelevantJobsStatusUpdate(
      data.email!,
      data.full_name || "",
      URL + "/jobs?sortBy=relevance",
      insufficientCredits,
    );

    return { success: true };
  } catch (error) {
    reportError("[relevant jobs] update failed", error);
    const msg =
      error instanceof Error ? error.message : "unknown error occured.";
    return { success: false, error: msg };
  }
}
