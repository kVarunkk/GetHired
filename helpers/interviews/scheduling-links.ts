import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { reportError } from "@/helpers/posthog/report-error";
import { SCHEDULING_MESSAGES, schedulingMessage } from "@/helpers/calendar/copy";
import { loadEventDetails } from "@/helpers/calendar/events";
import { unsubscribeUrl } from "@/helpers/candidates/unsubscribe-token";
import { sendCompanyMessage } from "@/helpers/email/send-company-message";
import { actorName, emailsLeftToday, firstName } from "@/helpers/pipeline/move";
import { renderTemplate } from "@/helpers/pipeline/templates";
import { interviewMessage } from "./copy";
import {
  hasSchedulingLink,
  renewLinkSchema,
  sendLinkSchema,
  type RenewLinkInput,
  type SendLinkInput,
} from "./scheduling-schema";
import { newSchedulingLink } from "./scheduling-token";

// Self-scheduling links (IVT-062, IVT-065, IV-REQ-020 "Send a link",
// IV-REQ-026). `supabase` is the session member's client: the RPCs check
// scheduling.manage, the connections and D20. `admin` reads the candidate's
// address (interview_event_details) and logs the email. The token exists only
// here and in the email: it is never stored, queued or logged.

type Db = SupabaseClient<Database>;

export type LinkDeps = { supabase: Db; admin: Db; user: User; company: MyCompany };

type Failure = { ok: false; error: string; reason: string };

export type SendLinkResult =
  | { ok: true; id: string; applicationId: string; url: string; expiresAt: string | null }
  | Failure;

export type RenewLinkResult =
  | {
      ok: true;
      id: string;
      applicationId: string;
      url: string;
      expiresAt: string | null;
      emailed: boolean;
      warning?: string;
    }
  | Failure;

/** The RPCs' reasons: the calendar and link ones, else the interview lifecycle's. */
export const linkMessage = (reason: string) =>
  reason in SCHEDULING_MESSAGES ? schedulingMessage(reason) : interviewMessage(reason);

const fail = (reason: string, error = linkMessage(reason)): Failure => ({ ok: false, error, reason });

// Values for checking a template before anything is created.
const CHECK_VARS = {
  candidate_first_name: "Ada",
  job_title: "Job",
  company_name: "Company",
  scheduling_link: "https://gethired.invalid/schedule/check",
  sender_name: "Sender",
};

type LinkRow = { ok: boolean; reason?: string; id?: string; application_id?: string; expires_at?: string };
type LinkEmail = { templateId: string; subject?: string; body?: string };
type PreparedEmail = {
  source: { templateId: string; subject: string; body_md: string };
  settings: { name: string | null; email: string | null; logo_url: string | null };
};

/**
 * Loads the company's own template with the edits applied and checks it
 * before anything is created: it must carry `{{scheduling_link}}` and only
 * known variables. Then the sender settings and the daily email cap.
 */
async function prepareEmail(deps: LinkDeps, email: LinkEmail): Promise<({ ok: true } & PreparedEmail) | Failure> {
  const { supabase, company } = deps;
  const { data: template, error: templateError } = await supabase
    .from("company_email_templates")
    .select("id, subject, body_md")
    .eq("id", email.templateId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (templateError) throw new Error(`Couldn't load the template: ${templateError.message}`);
  if (!template) return fail("template_not_found");
  const source = {
    templateId: template.id,
    subject: email.subject ?? template.subject,
    body_md: email.body ?? template.body_md,
  };
  if (!hasSchedulingLink(source.body_md)) return fail("needs_link");
  const check = renderTemplate(source, CHECK_VARS);
  if (!check.ok) return fail("invalid_template", check.error);
  if (check.unknownVariables.length > 0) {
    const list = check.unknownVariables.map((name) => `{{${name}}}`).join(", ");
    return fail("invalid_template", `Remove or fix ${list} before sending.`);
  }

  const { data: settings, error: settingsError } = await supabase
    .from("company_info")
    .select("name, email, logo_url")
    .eq("id", company.id)
    .single();
  if (settingsError || !settings) throw new Error(`Couldn't load the company: ${settingsError?.message}`);

  const left = await emailsLeftToday(supabase, company.id);
  if (left === null) return fail("cap_unknown");
  if (left < 1) return fail("daily_cap");
  return { ok: true, source, settings };
}

/**
 * Emails the link for an interview and logs it. The address comes from
 * interview_event_details, which hands it out only while the candidate may
 * be emailed (D20). A company candidate's email carries the unsubscribe link.
 */
async function deliverLink(
  deps: LinkDeps,
  { id, applicationId, url, source, settings }: { id: string; applicationId: string; url: string } & PreparedEmail,
): Promise<{ ok: true } | Failure> {
  const { admin, user, company } = deps;
  const [details, { data: application }] = await Promise.all([
    loadEventDetails(admin, id),
    admin.from("applications").select("applicant_user_id, company_candidate_id").eq("id", applicationId).single(),
  ]);
  if (!details?.candidate_email) return fail("no_candidate_email");

  const rendered = renderTemplate(source, {
    candidate_first_name: firstName(details.candidate_name),
    job_title: details.job_title,
    company_name: settings.name ?? company.name,
    scheduling_link: url,
    sender_name: actorName(user, company),
  });
  if (!rendered.ok) return fail("invalid_template", rendered.error);
  if (rendered.missingVariables.length > 0) {
    const list = rendered.missingVariables.map((name) => `{{${name}}}`).join(", ");
    return fail("invalid_template", `This candidate has no value for ${list}.`);
  }

  const candidateId = application?.company_candidate_id ?? null;
  const sent = await sendCompanyMessage({
    toEmail: details.candidate_email,
    subject: rendered.subject,
    bodyMd: rendered.body,
    companyName: settings.name ?? company.name ?? "the company",
    companyEmail: settings.email,
    logoUrl: settings.logo_url,
    // Every email to a company candidate carries the unsubscribe link (BI-REQ-034).
    ...(candidateId ? { unsubscribeUrl: unsubscribeUrl(candidateId) } : {}),
  });
  if (!sent.ok) {
    reportError("[scheduling links] the link email failed", id, sent.error);
    return fail("email_failed");
  }

  const { error: logError } = await admin.from("application_events").insert({
    company_id: company.id,
    application_id: applicationId,
    candidate_user_id: application?.applicant_user_id ?? null,
    actor_user_id: user.id,
    actor_name: actorName(user, company),
    type: "email_sent",
    // The subject only: the body, and the link in it, stay out of the log.
    payload: { template_id: source.templateId, subject: rendered.subject, scheduled_interview_id: id },
  });
  // The email already went out; a missing log line isn't worth failing for.
  if (logError) reportError("[scheduling links] couldn't log the email", id, logError.code);
  return { ok: true };
}

/**
 * Creates an `awaiting_candidate` interview and emails the candidate its
 * link through the company's template, where `{{scheduling_link}}` is this
 * interview's link. Counted against the daily email cap. If the email can't
 * go out, the interview is cancelled so no unreachable link is left waiting.
 */
export async function sendSchedulingLink(deps: LinkDeps, input: SendLinkInput): Promise<SendLinkResult> {
  const parsed = sendLinkSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0].message);
  const v = parsed.data;

  const prepared = await prepareEmail(deps, v);
  if (!prepared.ok) return prepared;

  const link = newSchedulingLink();
  const { data, error } = await deps.supabase.rpc("create_scheduling_link", {
    p_application_id: v.applicationId,
    p_panel: v.panel,
    p_token_hash: link.hash,
    ...(v.planItemId
      ? { p_plan_item_id: v.planItemId }
      : { p_name: v.name ?? undefined, p_duration_minutes: v.durationMinutes ?? undefined }),
  });
  if (error) throw new Error(`Couldn't create the scheduling link: ${error.message}`);
  const created = data as LinkRow | null;
  if (!created?.ok || !created.id) return fail(created?.reason ?? "error");
  const id = created.id;
  const applicationId = created.application_id ?? v.applicationId;

  const delivered = await deliverLink(deps, { id, applicationId, url: link.url, ...prepared });
  if (!delivered.ok) {
    const { error: cancelError } = await deps.supabase.rpc("cancel_interview", { p_id: id, p_reason: "email_failed" });
    if (cancelError) reportError("[scheduling links] couldn't cancel the unsent link", id, cancelError.code);
    return delivered;
  }
  return { ok: true, id, applicationId, url: link.url, expiresAt: created.expires_at ?? null };
}

/**
 * IVT-065: a fresh link for an interview sent as a link. "Resend" emails it
 * with a template; "Copy link" only returns it. Only hashes are stored, so
 * the old link can't be shown again: renewing replaces it, and the old one
 * stops working. If the resend email fails, the new link is still returned
 * for the member to copy, with a warning.
 */
export async function renewSchedulingLink(deps: LinkDeps, input: RenewLinkInput): Promise<RenewLinkResult> {
  const parsed = renewLinkSchema.safeParse(input);
  if (!parsed.success) return fail("invalid", parsed.error.issues[0].message);
  const { interviewId, email } = parsed.data;

  let prepared: PreparedEmail | null = null;
  if (email) {
    const checked = await prepareEmail(deps, email);
    if (!checked.ok) return checked;
    prepared = checked;
  }

  const link = newSchedulingLink();
  const { data, error } = await deps.supabase.rpc("renew_scheduling_link", { p_id: interviewId, p_token_hash: link.hash });
  if (error) throw new Error(`Couldn't renew the scheduling link: ${error.message}`);
  const renewed = data as LinkRow | null;
  if (!renewed?.ok || !renewed.application_id) return fail(renewed?.reason ?? "error");
  const base = {
    ok: true as const,
    id: interviewId,
    applicationId: renewed.application_id,
    url: link.url,
    expiresAt: renewed.expires_at ?? null,
  };
  if (!prepared) return { ...base, emailed: false };

  const delivered = await deliverLink(deps, { id: interviewId, applicationId: base.applicationId, url: link.url, ...prepared });
  if (!delivered.ok) {
    return {
      ...base,
      emailed: false,
      warning: `${delivered.error} The old link no longer works; copy the new one to send it yourself.`,
    };
  }
  return { ...base, emailed: true };
}
