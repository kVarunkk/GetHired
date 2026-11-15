import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { render } from "react-email";
import InterviewFeedbackReminder from "@/emails/InterviewFeedbackReminder";
import { isUuid } from "@/helpers/agent/auth";
import { firstName } from "@/helpers/outreach/linkify";
import { reportError } from "@/helpers/posthog/report-error";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import type { Database } from "@/utils/types/database.types";
import { reminderMessage } from "./copy";
import { kitPath } from "./feedback-emails";

// IVT-084 (IV-REQ-052): "Remind" on the Interviews section and the agent's
// remindInterviewers. `interviewer_reminders` checks scheduling.manage for the
// interview's job and decides who's due; with `p_claim` it stamps them first
// (at most once per member per interview per 24 h), so two clicks can't send
// twice. Only company members are emailed, never the candidate.

type Db = SupabaseClient<Database>;

export type ReminderMember = { userId: string; name: string };
export type ReminderSkip = ReminderMember & { reason: "submitted" | "recent" | "failed" };

type Failure = { ok: false; reason: string; error: string };

export type RemindResult =
  | { ok: true; applicationId: string; reminded: ReminderMember[]; skipped: ReminderSkip[] }
  | Failure;

export type ReminderPreview =
  | {
      ok: true;
      applicationId: string;
      interviewName: string;
      jobTitle: string;
      candidateName: string | null;
      due: ReminderMember[];
      skipped: ReminderSkip[];
    }
  | Failure;

type RpcMember = { user_id: string; name: string | null; state: "due" | "claimed" | "recent" | "submitted" };
type RpcResult = {
  ok: boolean;
  reason?: string;
  application_id?: string;
  interview_name?: string;
  job_title?: string;
  candidate_name?: string | null;
  members?: RpcMember[];
  claimed_at?: string | null;
};

const fail = (reason: string): Failure => ({ ok: false, reason, error: reminderMessage(reason) });

async function readReminders(supabase: Db, interviewId: string, claim: boolean): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("interviewer_reminders", { p_interview_id: interviewId, p_claim: claim });
  if (error) throw new Error(`Couldn't read the interview's panel: ${error.message}`);
  return (data ?? { ok: false, reason: "not_found" }) as unknown as RpcResult;
}

const member = (m: RpcMember): ReminderMember => ({ userId: m.user_id, name: m.name || "Interviewer" });

/** Who "Remind" would email, without claiming: the approval card and MCP's preview. */
export async function previewReminders(supabase: Db, interviewId: string): Promise<ReminderPreview> {
  if (!isUuid(interviewId)) return fail("not_found");
  const r = await readReminders(supabase, interviewId, false);
  if (!r.ok) return fail(r.reason ?? "not_found");
  const members = r.members ?? [];
  return {
    ok: true,
    applicationId: r.application_id ?? "",
    interviewName: r.interview_name ?? "Interview",
    jobTitle: r.job_title ?? "",
    candidateName: r.candidate_name ?? null,
    due: members.filter((m) => m.state === "due").map(member),
    skipped: members
      .filter((m) => m.state === "submitted" || m.state === "recent")
      .map((m) => ({ ...member(m), reason: m.state as "submitted" | "recent" })),
  };
}

/**
 * Emails each panel member who still owes a scorecard a link to their kit.
 * `supabase` is the session member's client (the RPC checks the permission);
 * `admin` reads the members' addresses and releases a claim whose email
 * failed, so that member can be reminded again.
 */
export async function remindInterviewers(
  { supabase, admin, senderName }: { supabase: Db; admin: Db; senderName: string },
  interviewId: string,
): Promise<RemindResult> {
  if (!isUuid(interviewId)) return fail("not_found");
  const r = await readReminders(supabase, interviewId, true);
  if (!r.ok) return fail(r.reason ?? "not_found");

  const reminded: ReminderMember[] = [];
  const skipped: ReminderSkip[] = [];
  const candidate = firstName(r.candidate_name ?? null) ?? "the candidate";
  const props = {
    interviewName: r.interview_name ?? "the interview",
    jobTitle: r.job_title ?? "",
    candidateFirstName: candidate,
    kitUrl: `${deploymentUrl()}${kitPath(interviewId)}`,
    requestedBy: senderName,
  };

  for (const m of r.members ?? []) {
    if (m.state === "submitted" || m.state === "recent") {
      skipped.push({ ...member(m), reason: m.state });
      continue;
    }
    if (m.state !== "claimed") continue;
    try {
      const { data: found } = await admin.auth.admin.getUserById(m.user_id);
      const toEmail = found?.user?.email;
      if (!toEmail) throw new Error("no email address");
      const message = <InterviewFeedbackReminder {...props} />;
      const [htmlContent, textContent] = await Promise.all([render(message), render(message, { plainText: true })]);
      await sendEmail({
        toEmail,
        subject: `Reminder: your scorecard for ${candidate} is still open`,
        htmlContent,
        textContent,
      });
      reminded.push(member(m));
    } catch (err) {
      reportError("[interviews] a reminder email failed", interviewId, err instanceof Error ? err.message : "error");
      if (r.claimed_at) {
        await admin.rpc("release_interviewer_reminder", {
          p_interview_id: interviewId,
          p_user_id: m.user_id,
          p_claimed_at: r.claimed_at,
        });
      }
      skipped.push({ ...member(m), reason: "failed" });
    }
  }
  return { ok: true, applicationId: r.application_id ?? "", reminded, skipped };
}
