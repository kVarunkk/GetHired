import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import { sendCompanyMessage } from "@/helpers/email/send-company-message";
import type { Database, TablesInsert } from "@/utils/types/database.types";
import { changesCandidateStatus, statusForKind, type PipelineStageKind } from "./status-map";
import { renderTemplate, type TemplateVariable } from "./templates";

/** PL-REQ-004 / PL-SEC-005: one action moves and emails at most this many. */
export const MAX_MOVE_APPLICATIONS = 50;
/** PL-SEC-005: company emails per day, counted from `email_sent` events since midnight IST. */
export const PL_DAILY_EMAIL_CAP = 300;
/** Sends at once, to stay gentle on the email providers. */
const SEND_CONCURRENCY = 5;

export type MoveSkipReason = "not_found" | "already_in_stage" | "email_failed";

/** An application the move found, with what callers need to tell the candidate. */
export type LoadedApplication = {
  id: string;
  jobPostId: string;
  candidateUserId: string | null;
  fromStageId: string | null;
  fromKind: PipelineStageKind | null;
  email: string | null;
  fullName: string | null;
  jobTitle: string;
  companyName: string | null;
};

/** Email the moved candidates with one of the company's templates (PL-REQ-004). */
export type MoveEmail = {
  templateId: string;
  /** The subject and body as edited, rendered instead of the template's. A missing one keeps the template's. */
  overrides?: { subject?: string; body?: string };
};

export type MoveFailure = {
  ok: false;
  error: string;
  unknownVariables?: string[];
  missingVariables?: TemplateVariable[];
};

export type MoveResult =
  | {
      ok: true;
      moved: number;
      emailed: number;
      skipped: { id: string; reason: MoveSkipReason }[];
      stage: { id: string; name: string; kind: PipelineStageKind };
      /** Every application that was found, moved or not (in input order). */
      applications: LoadedApplication[];
      movedIds: string[];
    }
  | MoveFailure;

type Ctx = { supabase: SupabaseClient<Database>; company: MyCompany; user: User };

const LOAD_COLUMNS =
  "id, applicant_user_id, stage_id, pipeline_stages(kind), user_info(email, full_name), job_postings!inner(id, company_id, title, company_info(name))";

/**
 * The member's name, stored with events, notes and emails so it survives them
 * leaving (pipeline difference 5). Their team display name, else their
 * account's name, else their email's local part; never the company name, so
 * teammates' actions stay told apart (teams difference 8, TM-REQ-008).
 */
export function actorName(user: User, company: MyCompany): string | null {
  const meta = user.user_metadata ?? {};
  for (const name of [company.displayName, meta.full_name, meta.name]) {
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return user.email?.split("@")[0] || null;
}

const IST_OFFSET_MS = 330 * 60_000;

/** Midnight in India (IST, UTC+5:30) today, as an ISO timestamp. */
export function startOfDayIst(now = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS).toISOString();
}

const firstName = (fullName: string | null) => fullName?.trim().split(/\s+/)[0] || null;

type EmailPlan = {
  templateId: string;
  companyName: string;
  companyEmail: string | null;
  logoUrl: string | null;
  /** Rendered per recipient, keyed by application id. */
  messages: Map<string, { subject: string; body: string }>;
};

/**
 * Loads the template and the company's settings, picks the recipients and
 * renders every message before anything moves, so a bad template, an unknown
 * variable or the daily cap refuses the whole action.
 */
async function planEmails(
  { supabase, company, user }: Ctx,
  stageKind: PipelineStageKind,
  toMove: LoadedApplication[],
  email: MoveEmail,
): Promise<{ ok: true; plan: EmailPlan } | MoveFailure> {
  if (!isUuid(email.templateId)) return { ok: false, error: "Template not found." };

  const { data: template, error: templateError } = await supabase
    .from("company_email_templates")
    .select("id, purpose, subject, body_md")
    .eq("id", email.templateId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (templateError) return { ok: false, error: "Failed to load the template." };
  if (!template) return { ok: false, error: "Template not found." };

  const { data: settings, error: settingsError } = await supabase
    .from("company_info")
    .select("name, email, logo_url, scheduling_url")
    .eq("id", company.id)
    .single();
  if (settingsError || !settings) return { ok: false, error: "Failed to load the company." };

  // A custom message goes to everyone moved; the rest only to candidates who'll see a new status.
  const recipients = toMove.filter(
    (app) => template.purpose === "custom" || changesCandidateStatus(app.fromKind, stageKind),
  );

  const source = {
    subject: email.overrides?.subject ?? template.subject,
    body_md: email.overrides?.body ?? template.body_md,
  };
  const companyName = settings.name ?? company.name ?? "the company";
  const senderName = actorName(user, company);
  const unknown = new Set<string>();
  const missing = new Set<TemplateVariable>();
  const messages = new Map<string, { subject: string; body: string }>();

  for (const app of recipients) {
    const rendered = renderTemplate(source, {
      candidate_first_name: firstName(app.fullName),
      job_title: app.jobTitle,
      company_name: companyName,
      scheduling_link: settings.scheduling_url,
      sender_name: senderName,
    });
    if (!rendered.ok) return rendered;
    rendered.unknownVariables.forEach((v) => unknown.add(v));
    rendered.missingVariables.forEach((v) => missing.add(v));
    messages.set(app.id, { subject: rendered.subject, body: rendered.body });
  }

  if (unknown.size > 0) {
    const list = [...unknown].map((v) => `{{${v}}}`).join(", ");
    return { ok: false, error: `Remove or fix ${list} before sending.`, unknownVariables: [...unknown] };
  }
  if (missing.size > 0) {
    const error = missing.has("scheduling_link")
      ? "Add a scheduling link in Settings, or remove {{scheduling_link}}."
      : `Some candidates have no value for ${[...missing].map((v) => `{{${v}}}`).join(", ")}.`;
    return { ok: false, error, missingVariables: [...missing] };
  }

  if (recipients.length > 0) {
    const { count, error: countError } = await supabase
      .from("application_events")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .eq("type", "email_sent")
      .gte("created_at", startOfDayIst());
    if (countError) return { ok: false, error: "Failed to check today's emails." };
    const left = Math.max(0, PL_DAILY_EMAIL_CAP - (count ?? 0));
    if (recipients.length > left) {
      return {
        ok: false,
        error: `You can send up to ${PL_DAILY_EMAIL_CAP} emails a day. ${left} left today.`,
      };
    }
  }

  return {
    ok: true,
    plan: {
      templateId: template.id,
      companyName,
      companyEmail: settings.email,
      logoUrl: settings.logo_url,
      messages,
    },
  };
}

/** Sends each planned message, a few at a time. Returns the ids that went out. */
async function sendEmails(plan: EmailPlan, apps: LoadedApplication[]): Promise<Set<string>> {
  const sent = new Set<string>();
  const queue = apps.filter((app) => plan.messages.has(app.id) && app.email);
  for (let i = 0; i < queue.length; i += SEND_CONCURRENCY) {
    await Promise.all(
      queue.slice(i, i + SEND_CONCURRENCY).map(async (app) => {
        const message = plan.messages.get(app.id)!;
        const result = await sendCompanyMessage({
          toEmail: app.email!,
          subject: message.subject,
          bodyMd: message.body,
          companyName: plan.companyName,
          companyEmail: plan.companyEmail,
          logoUrl: plan.logoUrl,
        });
        if (result.ok) sent.add(app.id);
      }),
    );
  }
  return sent;
}

type MoveInput = {
  applicationIds: string[];
  stageId: string;
  email?: MoveEmail;
  sameStatusIsNoop?: boolean;
};

type PreparedMove = {
  ok: true;
  stage: { id: string; name: string; kind: PipelineStageKind };
  skipped: { id: string; reason: MoveSkipReason }[];
  applications: LoadedApplication[];
  toMove: LoadedApplication[];
  plan: EmailPlan | null;
};

/**
 * Everything before the writes: validates the input, loads the stage and the
 * applications, and plans and renders the emails. Shared by
 * `moveApplications` and `previewMove`, so a preview refuses exactly what
 * the move would.
 */
async function prepareMove(
  ctx: Ctx,
  { applicationIds, stageId, email, sameStatusIsNoop = false }: MoveInput,
): Promise<PreparedMove | MoveFailure> {
  const { supabase, company } = ctx;
  if (
    !Array.isArray(applicationIds) ||
    applicationIds.length === 0 ||
    applicationIds.some((id) => typeof id !== "string" || !isUuid(id))
  ) {
    return { ok: false, error: "Choose at least one application." };
  }
  const ids = [...new Set(applicationIds)];
  if (ids.length > MAX_MOVE_APPLICATIONS) {
    return { ok: false, error: `Move up to ${MAX_MOVE_APPLICATIONS} applications at a time.` };
  }
  if (typeof stageId !== "string" || !isUuid(stageId)) {
    return { ok: false, error: "Stage not found." };
  }

  const { data: stage, error: stageError } = await supabase
    .from("pipeline_stages")
    .select("id, name, kind, archived")
    .eq("id", stageId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (stageError) return { ok: false, error: "Failed to load the stage." };
  if (!stage || stage.archived) return { ok: false, error: "Stage not found." };

  const { data: rows, error: loadError } = await supabase
    .from("applications")
    .select(LOAD_COLUMNS)
    .in("id", ids)
    .eq("job_postings.company_id", company.id);
  if (loadError) return { ok: false, error: "Failed to load the applications." };

  const byId = new Map(
    (rows ?? [])
      .filter((row) => row.job_postings?.company_id === company.id)
      .map((row) => [row.id, row]),
  );

  const skipped: { id: string; reason: MoveSkipReason }[] = [];
  const applications: LoadedApplication[] = [];
  const toMove: LoadedApplication[] = [];
  const targetStatus = statusForKind(stage.kind);

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      skipped.push({ id, reason: "not_found" });
      continue;
    }
    const app: LoadedApplication = {
      id,
      jobPostId: row.job_postings.id,
      candidateUserId: row.applicant_user_id,
      fromStageId: row.stage_id,
      fromKind: row.pipeline_stages?.kind ?? null,
      email: row.user_info?.email ?? null,
      fullName: row.user_info?.full_name ?? null,
      jobTitle: row.job_postings.title,
      companyName: row.job_postings.company_info?.name ?? company.name,
    };
    applications.push(app);

    const sameStatus = app.fromKind !== null && statusForKind(app.fromKind) === targetStatus;
    if (row.stage_id === stage.id || (sameStatusIsNoop && sameStatus)) {
      skipped.push({ id, reason: "already_in_stage" });
    } else {
      toMove.push(app);
    }
  }

  let plan: EmailPlan | null = null;
  if (email) {
    const planned = await planEmails(ctx, stage.kind, toMove, email);
    if (!planned.ok) return planned;
    plan = planned.plan;
  }

  return {
    ok: true,
    stage: { id: stage.id, name: stage.name, kind: stage.kind },
    skipped,
    applications,
    toMove,
    plan,
  };
}

/**
 * Moves up to 50 of the session company's applications to one of its active
 * stages (PL-TASK-002, PL-SEC-002). Applications on other companies' jobs,
 * missing ones and off-platform tracker rows are skipped as `not_found`, so
 * their existence isn't confirmed. Only `stage_id` is written: the
 * `applications_sync_status` trigger sets the candidate-facing status.
 *
 * With `email`, the candidates whose status changes (everyone moved, for a
 * `custom` template) get the company's message, to the address loaded from
 * the DB. Every message is rendered and the daily cap checked before
 * anything moves. A failed send is reported as `email_failed`; the move
 * stands. One insert logs the `stage_changed` and `email_sent` events.
 *
 * With `sameStatusIsNoop`, applications whose current stage already shows the
 * target's status are skipped as `already_in_stage` (status-only callers).
 */
export async function moveApplications(ctx: Ctx, input: MoveInput): Promise<MoveResult> {
  const prepared = await prepareMove(ctx, input);
  if (!prepared.ok) return prepared;
  const { supabase, company, user } = ctx;
  const { stage, skipped, applications, toMove, plan } = prepared;

  const result = { ok: true as const, skipped, stage, applications };
  if (toMove.length === 0) return { ...result, moved: 0, emailed: 0, movedIds: [] };

  const movedIds = toMove.map((a) => a.id);
  const { error: updateError } = await supabase
    .from("applications")
    .update({ stage_id: stage.id, updated_at: new Date().toISOString() })
    .in("id", movedIds);
  if (updateError) return { ok: false, error: "Failed to move the applications." };

  const sent = plan ? await sendEmails(plan, toMove) : new Set<string>();
  if (plan) {
    for (const app of toMove) {
      if (plan.messages.has(app.id) && !sent.has(app.id)) skipped.push({ id: app.id, reason: "email_failed" });
    }
  }

  const name = actorName(user, company);
  const actor = { company_id: company.id, actor_user_id: user.id, actor_name: name };
  const events: TablesInsert<"application_events">[] = toMove.map((app) => ({
    ...actor,
    application_id: app.id,
    candidate_user_id: app.candidateUserId,
    type: "stage_changed",
    payload: {
      from_stage_id: app.fromStageId,
      to_stage_id: stage.id,
      from_kind: app.fromKind,
      to_kind: stage.kind,
    },
  }));
  for (const app of toMove) {
    if (!plan || !sent.has(app.id)) continue;
    events.push({
      ...actor,
      application_id: app.id,
      candidate_user_id: app.candidateUserId,
      type: "email_sent",
      // The subject only: the body stays out of the log.
      payload: { template_id: plan.templateId, subject: plan.messages.get(app.id)!.subject },
    });
  }
  // The move already happened; a missing log line isn't worth failing it.
  const { error: eventsError } = await supabase.from("application_events").insert(events);
  if (eventsError) console.error("[pipeline/move] couldn't log the stage changes", eventsError);

  return { ...result, moved: toMove.length, emailed: sent.size, movedIds };
}

export type MovePreview = {
  ok: true;
  stage: { id: string; name: string; kind: PipelineStageKind };
  /** The applications found, in input order. */
  applications: { id: string; name: string | null; jobTitle: string; moves: boolean; emailed: boolean }[];
  /** Ids that aren't the company's applications. */
  notFound: number;
  /** The first recipient's rendered message, and how many will get one. */
  email: { subject: string; body: string; recipients: number } | null;
};

/**
 * What `moveApplications` would do with this input, without writing or
 * sending anything: for approval cards (RA-REQ-005). Refuses what the move
 * would refuse (unknown variables, the daily cap).
 */
export async function previewMove(ctx: Ctx, input: MoveInput): Promise<MovePreview | MoveFailure> {
  const prepared = await prepareMove(ctx, input);
  if (!prepared.ok) return prepared;
  const { stage, skipped, applications, toMove, plan } = prepared;

  const moving = new Set(toMove.map((a) => a.id));
  const willEmail = (app: LoadedApplication) => !!plan?.messages.has(app.id) && !!app.email;
  const recipients = toMove.filter(willEmail);
  const first = recipients[0] ? plan!.messages.get(recipients[0].id)! : null;

  return {
    ok: true,
    stage,
    applications: applications.map((app) => ({
      id: app.id,
      name: app.fullName,
      jobTitle: app.jobTitle,
      moves: moving.has(app.id),
      emailed: moving.has(app.id) && willEmail(app),
    })),
    notFound: skipped.filter((s) => s.reason === "not_found").length,
    email: first ? { ...first, recipients: recipients.length } : null,
  };
}
