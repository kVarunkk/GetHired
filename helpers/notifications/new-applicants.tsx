import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { render } from "react-email";
import ApplicantDigestEmail, { type DigestJob } from "@/emails/ApplicantDigestEmail";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import type { Database } from "@/utils/types/database.types";

export const COMPANY_NOTIFICATION_QUEUE = "company_notification_queue";
export const APPLICANT_DIGEST_QUEUE = "applicant_digest_queue";

/** PL-REQ-009: at most one instant email per job in this window. */
export const INSTANT_THROTTLE_MS = 15 * 60_000;
/** Reads before a message that keeps failing is archived. Throttled reads count too. */
export const NOTIFICATION_MAX_READS = 30;
/** A digest that keeps failing is given up after this many reads (PL-TEST-007). */
export const DIGEST_MAX_READS = 3;
/** The daily digest looks back this far when a company has never had one. */
const FIRST_DIGEST_LOOKBACK_MS = 24 * 60 * 60_000;
const MAX_APPLICANTS = 500;

export type CompanyNotificationMessage = { type: "new_applicant"; applicationId: string; jobPostId: string };
export type ApplicantDigestMessage = { companyId: string };

type Admin = SupabaseClient<Database>;

export const settingsUrl = () => `${deploymentUrl()}/company/settings#notifications`;

/** Where the digest starts: the watermark, or a day ago for a first digest. */
export const digestSince = (watermark: string | null, now = Date.now()) =>
  watermark ?? new Date(now - FIRST_DIGEST_LOOKBACK_MS).toISOString();

/**
 * The company's applications created after `since` (optionally on one job),
 * grouped by job, oldest first, with each candidate's name and completed fit
 * score. `newest` is the latest `created_at`, the next watermark.
 */
export async function loadNewApplicants(
  admin: Admin,
  { companyId, since, jobPostId }: { companyId: string; since: string; jobPostId?: string },
): Promise<{ jobs: DigestJob[]; newest: string | null }> {
  let query = admin
    .from("applications")
    .select(
      "id, created_at, user_info(full_name), application_screenings(status, fit_score), job_postings!inner(id, title, company_id)",
    )
    .eq("job_postings.company_id", companyId)
    .gt("created_at", since);
  if (jobPostId) query = query.eq("job_post_id", jobPostId);
  const { data, error } = await query.order("created_at", { ascending: true }).limit(MAX_APPLICANTS);
  if (error) throw new Error(`Couldn't load new applicants: ${error.message}`);

  const byJob = new Map<string, DigestJob>();
  let newest: string | null = null;
  for (const row of data ?? []) {
    const job = row.job_postings;
    const entry = byJob.get(job.id) ?? {
      title: job.title,
      url: `${deploymentUrl()}/company/job-posts/${job.id}/applicants`,
      applicants: [],
    };
    const screening = row.application_screenings;
    entry.applicants.push({
      name: row.user_info?.full_name?.trim() || "An applicant",
      fitScore: screening?.status === "completed" ? screening.fit_score : null,
    });
    byJob.set(job.id, entry);
    newest = row.created_at;
  }
  return { jobs: [...byJob.values()], newest };
}

/** Sends the digest or an instant alert to the company's contact email. */
export async function sendApplicantDigest({
  to,
  companyName,
  kind,
  jobs,
}: {
  to: string;
  companyName: string;
  kind: "daily" | "instant";
  jobs: DigestJob[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const email = (
      <ApplicantDigestEmail companyName={companyName} kind={kind} jobs={jobs} settingsUrl={settingsUrl()} />
    );
    const total = jobs.reduce((sum, job) => sum + job.applicants.length, 0);
    const [htmlContent, textContent] = await Promise.all([render(email), render(email, { plainText: true })]);
    await sendEmail({
      toEmail: to,
      subject:
        kind === "daily"
          ? `${total} new applicant${total === 1 ? "" : "s"} yesterday`
          : `New applicant${total === 1 ? "" : "s"} for ${jobs[0]?.title}`,
      htmlContent,
      textContent,
    });
    return { ok: true };
  } catch (err) {
    console.error("Error sending an applicant digest:", err);
    return { ok: false, error: "Failed to send email" };
  }
}
