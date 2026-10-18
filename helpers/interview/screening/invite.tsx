import "server-only";
import { after } from "next/server";
import { render } from "react-email";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import InterviewInviteEmail from "@/emails/InterviewInviteEmail";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { firstName } from "@/helpers/outreach/linkify";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import type { Database } from "@/utils/types/database.types";
import type { ConfigSnapshot, InterviewConfig } from "./schemas";

export const MAX_BULK_INVITES = 50;

export type InviteVia = "manual" | "agent" | "fit_threshold";

/** create_screening_invite's reasons, plus not_found for an application the caller can't invite. */
export type InviteSkipReason =
  | "disabled"
  | "manual_only"
  | "job_inactive"
  | "exists"
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

type InviteRpcResult = { ok: boolean; id?: string; reason?: InviteSkipReason };

export const screeningInterviewUrl = (applicationInterviewId: string) =>
  `${deploymentUrl()}/interview/screening/${applicationInterviewId}`;

/** What a bulk invite costs (SI-REQ-012): the job's length per interview. */
export function inviteCostPreview(config: Pick<InterviewConfig, "duration_minutes">, count: number) {
  return { minutesPerInvite: config.duration_minutes, totalMinutes: config.duration_minutes * count };
}

/**
 * Invites applications to one of the company's jobs (SI-REQ-010/012). The
 * caller has checked interviews.manage on `jobPostId`. Applications the
 * session can't see, or on another job, are skipped as not_found; the rest go
 * through create_screening_invite, which places the interview_minutes hold
 * charged to the session user. Invite emails go out after the response.
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
  const { data: visible, error } = await supabase.from("applications").select("id, job_post_id").in("id", ids);
  if (error) throw new Error(`Couldn't load the applications: ${error.message}`);
  const onJob = new Set((visible ?? []).filter((a) => a.job_post_id === jobPostId).map((a) => a.id));

  const admin = createServiceRoleClient();
  const invited: { id: string; applicationId: string }[] = [];
  const skipped: { id: string; reason: InviteSkipReason }[] = [];
  for (const id of ids) {
    if (!onJob.has(id)) {
      skipped.push({ id, reason: "not_found" });
      continue;
    }
    const { data, error: rpcError } = await admin.rpc("create_screening_invite", {
      p_application_id: id,
      p_via: via,
      p_invited_by: user.id,
    });
    const result = data as InviteRpcResult | null;
    if (rpcError || !result) {
      console.error("[screening] invite failed", id, rpcError?.message);
      skipped.push({ id, reason: "failed" });
    } else if (result.ok && result.id) {
      invited.push({ id: result.id, applicationId: id });
    } else {
      skipped.push({ id, reason: result.reason ?? "failed" });
    }
  }

  if (invited.length > 0) {
    after(() => sendInterviewInviteEmails(admin, invited.map((i) => i.id)));
  }
  return { ok: true, invited, skipped };
}

/**
 * The invite email for each new interview (SI-REQ-013). Shared with the
 * fit-threshold invite in the screening worker. Failures are logged, never
 * thrown: the invite stands and shows on the dashboard.
 */
export async function sendInterviewInviteEmails(admin: SupabaseClient<Database>, applicationInterviewIds: string[]) {
  const { data: interviews, error } = await admin
    .from("application_interviews")
    .select("id, applicant_user_id, deadline_at, config_snapshot")
    .in("id", applicationInterviewIds);
  if (error || !interviews?.length) {
    if (error) console.error("[screening] couldn't load invites for email", error.message);
    return;
  }
  const { data: people } = await admin
    .from("user_info")
    .select("user_id, email, full_name")
    .in("user_id", interviews.map((i) => i.applicant_user_id));
  const personOf = new Map((people ?? []).map((p) => [p.user_id, p]));

  for (const interview of interviews) {
    const person = personOf.get(interview.applicant_user_id);
    if (!person?.email) continue;
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
    try {
      const [htmlContent, textContent] = await Promise.all([render(message), render(message, { plainText: true })]);
      await sendEmail({
        toEmail: person.email,
        subject: `${snapshot.company_name} invited you to an AI interview for ${snapshot.job_title}`,
        htmlContent,
        textContent,
        senderName: `${snapshot.company_name} via GetHired`,
      });
    } catch (err) {
      console.error("[screening] invite email failed", interview.id, err);
    }
  }
}
