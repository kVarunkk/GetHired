import "server-only";
import { render } from "react-email";
import type { SupabaseClient } from "@supabase/supabase-js";
import InterviewAccommodationRequestEmail from "@/emails/InterviewAccommodationRequestEmail";
import InterviewCompletedCompanyEmail from "@/emails/InterviewCompletedCompanyEmail";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import type { Database } from "@/utils/types/database.types";
import type { ConfigSnapshot } from "./schemas";

export const companyApplicantUrl = (applicationId: string) =>
  `${deploymentUrl()}/company/applicants/${applicationId}`;

/**
 * Who hears about an interview: the company's owners and the members whose
 * role has interviews.view on the job (all jobs, or this one when assigned).
 * Service role: it reads other users' memberships and emails.
 */
export async function interviewRecipientEmails(
  admin: SupabaseClient<Database>,
  companyId: string,
  jobPostId: string,
): Promise<string[]> {
  const { data: members, error } = await admin
    .from("company_members")
    .select("user_id, is_owner, role_id")
    .eq("company_id", companyId);
  if (error) throw new Error(`Couldn't load the team: ${error.message}`);

  const roleIds = [...new Set((members ?? []).map((m) => m.role_id).filter((id): id is string => !!id))];
  const { data: grants } = roleIds.length
    ? await admin
        .from("company_role_permissions")
        .select("role_id, scope")
        .eq("permission_key", "interviews.view")
        .in("role_id", roleIds)
    : { data: [] };
  const scopeOf = new Map((grants ?? []).map((g) => [g.role_id, g.scope]));

  const { data: assignments } = await admin
    .from("company_job_assignments")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("job_post_id", jobPostId);
  const assigned = new Set((assignments ?? []).map((a) => a.user_id));

  const userIds = (members ?? [])
    .filter((m) => {
      if (m.is_owner) return true;
      const scope = m.role_id ? scopeOf.get(m.role_id) : undefined;
      return scope === "all" || (scope === "assigned" && assigned.has(m.user_id));
    })
    .map((m) => m.user_id);

  const emails = await Promise.all(
    userIds.map(async (id) => (await admin.auth.admin.getUserById(id)).data.user?.email ?? null),
  );
  return [...new Set(emails.filter((e): e is string => !!e))];
}

/**
 * Emails the company that a candidate asked for an alternative format, or
 * declined (SI-REQ-016/026). Logged on failure, never thrown.
 */
export async function notifyCompanyOfCandidateResponse(
  admin: SupabaseClient<Database>,
  applicationInterviewId: string,
  kind: "accommodation" | "declined",
) {
  try {
    const { data: interview } = await admin
      .from("application_interviews")
      .select("id, company_id, job_post_id, application_id, applicant_user_id, accommodation_request, config_snapshot")
      .eq("id", applicationInterviewId)
      .maybeSingle();
    if (!interview) return;
    const { data: person } = await admin
      .from("user_info")
      .select("full_name")
      .eq("user_id", interview.applicant_user_id)
      .maybeSingle();
    const candidateName = person?.full_name?.trim() || "A candidate";
    const jobTitle = (interview.config_snapshot as ConfigSnapshot).job_title;
    const applicantUrl = companyApplicantUrl(interview.application_id);

    const message =
      kind === "accommodation" ? (
        <InterviewAccommodationRequestEmail
          kind="accommodation"
          candidateName={candidateName}
          jobTitle={jobTitle}
          message={interview.accommodation_request ?? ""}
          applicantUrl={applicantUrl}
        />
      ) : (
        <InterviewAccommodationRequestEmail
          kind="declined"
          candidateName={candidateName}
          jobTitle={jobTitle}
          applicantUrl={applicantUrl}
        />
      );
    const subject =
      kind === "accommodation"
        ? `${candidateName} asked for an alternative to the AI interview`
        : `${candidateName} declined the AI interview`;

    const recipients = await interviewRecipientEmails(admin, interview.company_id, interview.job_post_id);
    if (recipients.length === 0) return;
    const [htmlContent, textContent] = await Promise.all([render(message), render(message, { plainText: true })]);
    for (const toEmail of recipients) {
      await sendEmail({ toEmail, subject, htmlContent, textContent });
    }
  } catch (err) {
    console.error("[screening] company notification failed", applicationInterviewId, err);
  }
}

/**
 * Whether a `finish_screening_session` result is an interview that just
 * completed with nothing to score ("Interview incomplete"). No report is
 * queued for it, so the analysis worker never emails the company: the caller
 * does, with `scored: false`.
 */
export function completedUnscored(result: unknown): boolean {
  const r = result as { status?: string; interview_status?: string; analysis_id?: string | null } | null;
  return r?.status === "recorded" && r.interview_status === "completed" && !r.analysis_id;
}

/**
 * Emails the company that a candidate finished the interview (SI-REQ-030):
 * from the analysis worker once the report is ready, or when the interview
 * completed too short to score. Logged on failure, never thrown.
 */
export async function notifyCompanyOfCompletedInterview(
  admin: SupabaseClient<Database>,
  applicationInterviewId: string,
  { scored }: { scored: boolean },
) {
  try {
    const { data: interview, error } = await admin
      .from("application_interviews")
      .select("id, company_id, job_post_id, application_id, applicant_user_id, config_snapshot")
      .eq("id", applicationInterviewId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!interview) return;
    const { data: person } = await admin
      .from("user_info")
      .select("full_name")
      .eq("user_id", interview.applicant_user_id)
      .maybeSingle();
    const candidateName = person?.full_name?.trim() || "A candidate";
    const jobTitle = (interview.config_snapshot as ConfigSnapshot).job_title;

    const recipients = await interviewRecipientEmails(admin, interview.company_id, interview.job_post_id);
    if (recipients.length === 0) return;
    const message = (
      <InterviewCompletedCompanyEmail
        candidateName={candidateName}
        jobTitle={jobTitle}
        reportUrl={companyApplicantUrl(interview.application_id)}
        scored={scored}
      />
    );
    const subject = `${candidateName} finished the AI interview for ${jobTitle}`;
    const [htmlContent, textContent] = await Promise.all([render(message), render(message, { plainText: true })]);
    for (const toEmail of recipients) {
      await sendEmail({ toEmail, subject, htmlContent, textContent });
    }
  } catch (err) {
    console.error("[screening] completion notification failed", applicationInterviewId, err);
  }
}
