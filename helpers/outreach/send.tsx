import "server-only";
import { reportError } from "@/helpers/posthog/report-error";
import { randomUUID } from "node:crypto";
import { render } from "react-email";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import OutreachEmail from "@/emails/OutreachEmail";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import {
  consumeEntitlement,
  holdEntitlement,
  releaseHold,
  type EntitlementRef,
} from "@/helpers/billing/entitlements";
import {
  EntitlementError,
  toEntitlementActionError,
  type EntitlementActionError,
} from "@/helpers/billing/errors";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import { PostHogEvent } from "@/utils/types";
import type { Database } from "@/utils/types/database.types";
import type { CandidateOutreach, OutreachSource } from "@/utils/types/outreach.types";
import { sendOutreachSchema } from "./config";
import { forbiddenOutreachError, mapOutreachError, type OutreachErrorCode } from "./errors";

export type OutreachDeps = {
  /** The session user's RLS client: send_candidate_outreach checks membership with it. */
  supabase: SupabaseClient<Database>;
  company: MyCompany;
  user: User;
};

export type SendOutreachResult =
  | { ok: true; outreach: CandidateOutreach; emailed: boolean }
  | { ok: false; error: string; code: OutreachErrorCode; status: number }
  | ({ ok: false } & EntitlementActionError);

/**
 * Sends one outreach (OR-TASK-002). Shared by the server action, the
 * `/api/company/outreach` route and the recruiter agent; `source` comes from
 * the caller, never from input.
 *
 * Billing (difference 1): hold one `outreach` unit with the outreach id as the
 * ref, run the RPC with that id, then consume on success or release on
 * failure. The hold is atomic, so parallel sends can't overspend. Once the row
 * exists the unit is charged even if the email fails: the candidate still sees
 * the outreach in Opportunities.
 */
export async function sendOutreach(
  { supabase, company, user }: OutreachDeps,
  input: unknown,
  { source }: { source: OutreachSource },
): Promise<SendOutreachResult> {
  const parsed = sendOutreachSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the subject and message and try again.", code: "INVALID_INPUT", status: 400 };
  }
  const { candidateId, jobPostId, subject, message } = parsed.data;

  // RPT-053: the RPC checks the job scope too, but only after the hold.
  if (!can(company, "outreach.send", jobPostId ?? null)) {
    const denied = forbiddenOutreachError();
    return { ok: false, error: denied.message, code: denied.code, status: denied.status };
  }

  const id = randomUUID();
  const ref: EntitlementRef = { type: "outreach", id };

  try {
    await holdEntitlement(company.id, "outreach", 1, ref, user.id);
  } catch (err) {
    if (err instanceof EntitlementError) return { ok: false, ...toEntitlementActionError(err) };
    reportError("[outreach] hold failed:", err);
    return { ok: false, error: "Something went wrong. Try again.", code: "UNKNOWN", status: 500 };
  }

  const { data, error } = await supabase.rpc("send_candidate_outreach", {
    p_id: id,
    p_candidate: candidateId,
    // Nullable in SQL; the generated type marks it required.
    p_job_post: (jobPostId ?? null) as string,
    p_subject: subject,
    p_message: message,
    p_source: source,
  });

  if (error || !data) {
    try {
      await releaseHold(company.id, "outreach", ref);
    } catch (releaseErr) {
      reportError("[outreach] release failed:", releaseErr);
    }
    const mapped = mapOutreachError(error);
    if (mapped.code === "UNKNOWN") reportError("[outreach] send failed:", error);
    return { ok: false, error: mapped.message, code: mapped.code, status: mapped.status };
  }

  const outreach = data as CandidateOutreach;

  try {
    await consumeEntitlement(company.id, "outreach", 1, ref, user.id);
  } catch (err) {
    // The hold already reserved the unit; log rather than fail a sent message.
    reportError("[outreach] consume failed:", err);
  }

  const emailed = await emailCandidate(company, outreach);

  await eventCaptureServer({
    event: PostHogEvent.OutreachSent,
    distinctId: user.id,
    properties: { has_job: outreach.job_post_id !== null, source },
  });

  return { ok: true, outreach, emailed };
}

/** Emails the candidate. The address is loaded with the service role, never taken from input. */
async function emailCandidate(company: MyCompany, outreach: CandidateOutreach): Promise<boolean> {
  try {
    const service = createServiceRoleClient();
    const [{ data: candidate }, { data: companyRow }, job] = await Promise.all([
      service.from("user_info").select("email").eq("user_id", outreach.candidate_user_id).maybeSingle(),
      service.from("company_info").select("name, logo_url").eq("id", company.id).maybeSingle(),
      outreach.job_post_id
        ? service.from("job_postings").select("title").eq("id", outreach.job_post_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (!candidate?.email) return false;

    const companyName = companyRow?.name ?? company.name ?? "A company";
    const base = deploymentUrl();
    const email = (
      <OutreachEmail
        companyName={companyName}
        logoUrl={companyRow?.logo_url ?? null}
        jobTitle={job.data?.title ?? null}
        subject={outreach.subject}
        message={outreach.message}
        respondUrl={`${base}/opportunities/${outreach.id}`}
        settingsUrl={`${base}/settings`}
      />
    );
    const [htmlContent, textContent] = await Promise.all([
      render(email),
      render(email, { plainText: true }),
    ]);

    await sendEmail({
      toEmail: candidate.email,
      subject: `${companyName}: ${outreach.subject}`,
      htmlContent,
      textContent,
      senderName: `${companyName} via GetHired`,
    });
    return true;
  } catch (err) {
    reportError("[outreach] email failed:", err);
    return false;
  }
}
