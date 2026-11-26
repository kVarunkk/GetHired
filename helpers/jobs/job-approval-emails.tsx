import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { render } from "react-email";
import JobApprovalDecisionEmail from "@/emails/JobApprovalDecisionEmail";
import JobApprovalRequestEmail from "@/emails/JobApprovalRequestEmail";
import { reportError } from "@/helpers/posthog/report-error";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import type { Database } from "@/utils/types/database.types";
import type { JobPostState } from "./job-states";
import { emailsOf, jobPermissionHolders } from "./job-team-emails";
import { jobPostPath } from "./paths";

type Admin = SupabaseClient<Database>;

export type ApprovalMove = {
  companyId: string;
  postId: string;
  title: string;
  from: JobPostState;
  to: JobPostState;
  /** Who made the move (the session user). */
  actorId: string | null;
  /** The note on the move, which a request for changes always has. */
  note: string | null;
};

/**
 * JL-REQ-021: the approval emails that follow a move that applied. Run in
 * `after()` by `setJobPostState`, with the service role (it reads other
 * members' roles and emails). Never throws; a failed send is reported.
 *
 * - Submitted: to the members who hold `jobs.approve` on the job, except the
 *   submitter, or to the owners when there are none.
 * - Approved / changes requested: to the submitter, with the note. A
 *   submitter withdrawing their own job hears nothing.
 */
export async function sendApprovalEmails(admin: Admin, move: ApprovalMove): Promise<void> {
  try {
    if (move.to === "pending_approval") await sendRequest(admin, move);
    else if (move.from === "pending_approval" && (move.to === "open" || move.to === "draft")) {
      await sendDecision(admin, move);
    }
  } catch (err) {
    reportError(`[job approval] couldn't send the email for ${move.postId}`, err);
  }
}

async function sendRequest(admin: Admin, move: ApprovalMove) {
  const { holders, owners } = await jobPermissionHolders(admin, move.companyId, move.postId, "jobs.approve");
  const others = (ids: string[]) => ids.filter((id) => id !== move.actorId);
  const recipients = others(holders).length > 0 ? others(holders) : others(owners);
  if (recipients.length === 0) return;

  const message = (
    <JobApprovalRequestEmail
      jobTitle={move.title}
      submitterName={await memberName(admin, move.companyId, move.actorId)}
      jobUrl={`${deploymentUrl()}${jobPostPath(move.postId)}`}
    />
  );
  await send(admin, recipients, `${move.title} is waiting for your approval`, message);
}

async function sendDecision(admin: Admin, move: ApprovalMove) {
  const { data: submission } = await admin
    .from("job_post_state_events")
    .select("actor_user_id")
    .eq("job_post_id", move.postId)
    .eq("to_state", "pending_approval")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const submitterId = submission?.actor_user_id ?? null;
  if (!submitterId || submitterId === move.actorId) return;

  const approved = move.to === "open";
  const message = (
    <JobApprovalDecisionEmail
      jobTitle={move.title}
      decision={approved ? "approved" : "changes_requested"}
      reviewerName={await memberName(admin, move.companyId, move.actorId)}
      note={move.note}
      jobUrl={`${deploymentUrl()}${jobPostPath(move.postId)}${approved ? "" : "/edit"}`}
    />
  );
  await send(
    admin,
    [submitterId],
    approved ? `${move.title} was approved` : `Changes requested on ${move.title}`,
    message,
  );
}

async function send(admin: Admin, userIds: string[], subject: string, message: React.ReactElement) {
  const emails = await emailsOf(admin, userIds);
  if (emails.length === 0) return;
  const [htmlContent, textContent] = await Promise.all([render(message), render(message, { plainText: true })]);
  for (const toEmail of emails) {
    try {
      await sendEmail({ toEmail, subject, htmlContent, textContent });
    } catch (err) {
      reportError("[job approval] an email failed", err);
    }
  }
}

async function memberName(admin: Admin, companyId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin
    .from("company_members")
    .select("display_name")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.display_name?.trim() || null;
}
