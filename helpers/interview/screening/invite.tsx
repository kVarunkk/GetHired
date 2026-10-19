import "server-only";
import { render } from "react-email";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import InterviewInviteEmail from "@/emails/InterviewInviteEmail";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { firstName } from "@/helpers/outreach/linkify";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import type { Database, Tables } from "@/utils/types/database.types";
import type { ConfigSnapshot, InterviewConfig } from "./schemas";

export const MAX_BULK_INVITES = 50;

export type InviteVia = "manual" | "agent" | "fit_threshold";

/** create_screening_invite's reasons, plus not_found for an application the caller can't invite. */
export type InviteSkipReason =
  | "disabled"
  | "manual_only"
  | "job_inactive"
  | "exists"
  | "closed"
  | "not_applicant"
  | "insufficient_credits"
  | "member_limit"
  | "not_found"
  | "failed";

export type InviteApplicantsResult =
  | {
      ok: true;
      invited: { id: string; applicationId: string }[];
      skipped: { id: string; reason: InviteSkipReason }[];
    }
  | { ok: false; error: string };

/** One row of create_screening_invites. */
type InviteRpcResult = { application_id: string; ok: boolean; id?: string; reason?: InviteSkipReason };

export const screeningInterviewUrl = (applicationInterviewId: string) =>
  `${deploymentUrl()}/interview/screening/${applicationInterviewId}`;

/** What a bulk invite costs (SI-REQ-012): the job's length per interview. */
export function inviteCostPreview(config: Pick<InterviewConfig, "duration_minutes">, count: number) {
  return { minutesPerInvite: config.duration_minutes, totalMinutes: config.duration_minutes * count };
}

/**
 * Invites applications to one of the company's jobs (SI-REQ-010/012). The
 * caller has checked interviews.manage on `jobPostId`. Applications the
 * session can't see are skipped as not_found; the rest go through one
 * create_screening_invites call, which skips applications on another job as
 * not_found, places each interview_minutes hold charged to the session user
 * and queues each invite email for /api/worker/screening-invite-emails.
 */
export async function inviteApplicants(
  { supabase, user }: { supabase: SupabaseClient<Database>; company: MyCompany; user: User },
  { jobPostId, applicationIds, via }: { jobPostId: string; applicationIds: string[]; via: Exclude<InviteVia, "fit_threshold"> },
): Promise<InviteApplicantsResult> {
  const ids = [...new Set(applicationIds)];
  if (ids.length > MAX_BULK_INVITES) {
    return { ok: false, error: `Invite at most ${MAX_BULK_INVITES} applicants at a time.` };
  }
  if (ids.length === 0) return { ok: true, invited: [], skipped: [] };

  // RLS: only applications on jobs the member has applicants.view on.
  const { data: visible, error } = await supabase.from("applications").select("id").in("id", ids);
  if (error) throw new Error(`Couldn't load the applications: ${error.message}`);
  const visibleIds = new Set((visible ?? []).map((a) => a.id));
  const toInvite = ids.filter((id) => visibleIds.has(id));

  const results = new Map<string, InviteRpcResult>();
  if (toInvite.length > 0) {
    const { data, error: rpcError } = await createServiceRoleClient().rpc("create_screening_invites", {
      p_job_post_id: jobPostId,
      p_application_ids: toInvite,
      p_via: via,
      p_invited_by: user.id,
    });
    // The call is one transaction: on an error nothing was created.
    if (rpcError) console.error("[screening] bulk invite failed", rpcError.message);
    for (const row of (data as InviteRpcResult[] | null) ?? []) results.set(row.application_id, row);
  }

  const invited: { id: string; applicationId: string }[] = [];
  const skipped: { id: string; reason: InviteSkipReason }[] = [];
  for (const id of ids) {
    const result = results.get(id);
    if (!visibleIds.has(id)) skipped.push({ id, reason: "not_found" });
    else if (result?.ok && result.id) invited.push({ id: result.id, applicationId: id });
    else skipped.push({ id, reason: result?.reason ?? "failed" });
  }
  return { ok: true, invited, skipped };
}

export type InviteEmailInterview = Pick<Tables<"application_interviews">, "id" | "deadline_at" | "config_snapshot">;

/**
 * The invite email for one interview (SI-REQ-013), sent by
 * /api/worker/screening-invite-emails. Throws when the send fails, so the
 * worker can retry it.
 */
export async function sendInterviewInviteEmail(
  interview: InviteEmailInterview,
  person: { email: string; full_name: string | null },
) {
  const snapshot = interview.config_snapshot as ConfigSnapshot;
  const message = (
    <InterviewInviteEmail
      firstName={firstName(person.full_name)}
      companyName={snapshot.company_name}
      jobTitle={snapshot.job_title}
      durationMinutes={snapshot.duration_minutes}
      competencyNames={snapshot.competencies.map((c) => c.name)}
      deadlineAt={interview.deadline_at}
      interviewUrl={screeningInterviewUrl(interview.id)}
    />
  );
  const [htmlContent, textContent] = await Promise.all([render(message), render(message, { plainText: true })]);
  await sendEmail({
    toEmail: person.email,
    subject: `${snapshot.company_name} invited you to an AI interview for ${snapshot.job_title}`,
    htmlContent,
    textContent,
    senderName: `${snapshot.company_name} via GetHired`,
  });
}
