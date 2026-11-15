import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { render } from "react-email";
import InterviewFeedbackReminder from "@/emails/InterviewFeedbackReminder";
import InterviewFeedbackRequest from "@/emails/InterviewFeedbackRequest";
import { firstName } from "@/helpers/outreach/linkify";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import type { Database } from "@/utils/types/database.types";

type Admin = SupabaseClient<Database>;

/** Emails per run; the cron runs every 15 minutes. */
export const FEEDBACK_BATCH = 100;

export const kitPath = (interviewId: string) => `/company/interviews/${interviewId}`;

export type FeedbackEmailSummary = { due: number; sent: number; skipped: number; failures: string[] };

/**
 * IV-REQ-040 / D11 (IVT-070): the request when an interview is over and one
 * reminder 24 h later, to each panel member who hasn't submitted a scorecard.
 * `interview_feedback_due` decides who's due; each email is claimed first
 * (a guarded update, so it's sent once) and released if the send fails, so
 * the next run retries it. Runs with the service role.
 */
export async function sendInterviewFeedbackEmails(admin: Admin): Promise<FeedbackEmailSummary> {
  const { data, error } = await admin.rpc("interview_feedback_due", { p_limit: FEEDBACK_BATCH });
  if (error) throw new Error(`Couldn't list the feedback emails: ${error.message}`);
  const rows = data ?? [];
  const summary: FeedbackEmailSummary = { due: rows.length, sent: 0, skipped: 0, failures: [] };

  for (const row of rows) {
    const kind = row.kind === "reminder" ? "reminder" : "request";
    const { data: claimedAt, error: claimError } = await admin.rpc("claim_interview_feedback_email", {
      p_interview_id: row.interview_id,
      p_user_id: row.user_id,
      p_kind: kind,
    });
    if (claimError) {
      summary.failures.push(`${row.interview_id}/${row.user_id}: claim ${claimError.message}`);
      continue;
    }
    if (!claimedAt) {
      summary.skipped += 1;
      continue;
    }

    try {
      const { data: found } = await admin.auth.admin.getUserById(row.user_id);
      const toEmail = found?.user?.email;
      // No address: there's nobody to retry for, so the claim stays.
      if (!toEmail) {
        summary.skipped += 1;
        continue;
      }
      const candidate = firstName(row.candidate_name) ?? "the candidate";
      const props = {
        interviewName: row.interview_name,
        jobTitle: row.job_title,
        candidateFirstName: candidate,
        kitUrl: `${deploymentUrl()}${kitPath(row.interview_id)}`,
      };
      const message =
        kind === "request" ? <InterviewFeedbackRequest {...props} /> : <InterviewFeedbackReminder {...props} />;
      const [htmlContent, textContent] = await Promise.all([render(message), render(message, { plainText: true })]);
      await sendEmail({
        toEmail,
        subject:
          kind === "request"
            ? `Your scorecard for ${candidate}: ${row.interview_name}`
            : `Reminder: your scorecard for ${candidate} is still open`,
        htmlContent,
        textContent,
      });
      summary.sent += 1;
    } catch (err) {
      await admin.rpc("release_interview_feedback_email", {
        p_interview_id: row.interview_id,
        p_user_id: row.user_id,
        p_kind: kind,
        p_claimed_at: claimedAt,
      });
      summary.failures.push(`${row.interview_id}/${row.user_id}: ${err instanceof Error ? err.message : "error"}`);
    }
  }
  return summary;
}
