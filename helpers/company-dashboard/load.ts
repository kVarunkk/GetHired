import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  applicationPersonOrNull,
  COMPANY_CANDIDATE_PERSON_COLUMNS,
} from "@/helpers/applications/application-person";
import { canViewBilling } from "@/helpers/billing/access";
import { getEntitlements } from "@/helpers/billing/entitlements";
import type { AllowanceKey } from "@/helpers/billing/keys";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { listPoolMatches } from "@/helpers/candidates/pool-matches";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { scopeToJobs } from "@/helpers/companies/job-scope";
import { can, canAny } from "@/helpers/companies/permissions";
import { endOfDayIn, todayIn } from "@/helpers/companies/time-zone";
import { listScreeningsToReview } from "@/helpers/interview/screening/to-review";
import { listMyInterviews } from "@/helpers/interviews/my-interviews";
import type { MyInterview } from "@/helpers/interviews/my-interviews-view";
import { loadLinkTemplates } from "@/helpers/interviews/scheduler-calendar";
import { hasSchedulingLink } from "@/helpers/interviews/scheduling-schema";
import { POOL_MATCH_LIMIT } from "@/helpers/matching/config";
import { loadCandidateNames } from "@/helpers/outreach/list";
import { listTemplates, type EmailTemplate } from "@/helpers/pipeline/email-templates";
import type { PipelineStageKind } from "@/helpers/pipeline/status-map";
import { reportError } from "@/helpers/posthog/report-error";
import type { Database } from "@/utils/types/database.types";
import {
  CLOSING_SOON_DAYS,
  NEW_JOB_DAYS,
  OUTREACH_REPLY_DAYS,
  STALE_DRAFT_DAYS,
  type AttentionJob,
  type OutreachReply,
  type SetupFacts,
} from "./summary";
import type { NewJob } from "./suggestions";

// The company dashboard's reads (CD §7). `loadDashboardSummary` is the page's
// core and throws. Everything else goes through `section`, so a failure hides
// that section only. A section the member can't see isn't loaded.

const DAY_MS = 86_400_000;
const ATTENTION_FETCH_LIMIT = 20;
const ATTENTION_JOBS_LIMIT = 100;
const POOL_JOBS = 3;
const OPEN_JOBS = 5;
const NEW_APPLICATIONS = 5;

export type DashboardCtx = {
  supabase: SupabaseClient<Database>;
  company: MyCompany;
  userId: string;
  now: Date;
};

/** A section's load, or null when it fails (CD-REQ-036). */
export async function section<T>(name: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    reportError(`[company dashboard] couldn't load ${name}`, err);
    return null;
  }
}

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Failed to load ${what}: ${error.message}`);
}

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();

const RpcSummary = z.object({
  open_jobs: z.number(),
  new_today: z.number(),
  new_7d: z.number(),
  waiting: z.number(),
});

export type DashboardSummary = { openJobs: number; newToday: number; new7d: number; waiting: number };

/** CD-REQ-010: the counts, scoped by the database to the member's jobs. Throws. */
export async function loadDashboardSummary(supabase: SupabaseClient<Database>): Promise<DashboardSummary> {
  const { data, error } = await supabase.rpc("company_dashboard_summary");
  check(error, "the summary");
  const summary = RpcSummary.parse(data);
  return {
    openJobs: summary.open_jobs,
    newToday: summary.new_today,
    new7d: summary.new_7d,
    waiting: summary.waiting,
  };
}

export type CompanyProfile = {
  timeZone: string | null;
  logoUrl: string | null;
  description: string | null;
  careers: { slug: string; published: boolean } | null;
};

export async function loadCompanyProfile({ supabase, company }: DashboardCtx): Promise<CompanyProfile> {
  const { data, error } = await supabase
    .from("company_info")
    .select("time_zone, logo_url, description, careers_slug, careers_published")
    .eq("id", company.id)
    .maybeSingle();
  check(error, "the company");
  return {
    timeZone: data?.time_zone ?? null,
    logoUrl: data?.logo_url ?? null,
    description: data?.description ?? null,
    careers: data?.careers_slug ? { slug: data.careers_slug, published: Boolean(data.careers_published) } : null,
  };
}

/**
 * CD-REQ-014: the member's own seats that start from the start of the company's
 * day to 24 hours from now. Needs no permission.
 */
export async function loadTodaysInterviews(
  { supabase, now }: DashboardCtx,
  timeZone: string | null,
): Promise<MyInterview[]> {
  const yesterday = todayIn(timeZone, new Date(now.getTime() - DAY_MS));
  const endOfYesterday = endOfDayIn(yesterday, timeZone);
  const from = endOfYesterday ? Date.parse(endOfYesterday) + 1000 : now.getTime() - DAY_MS;
  const to = now.getTime() + DAY_MS;

  const interviews = await listMyInterviews(supabase);
  return interviews
    .filter((i) => {
      if (!i.startsAt || (i.status !== "scheduled" && i.status !== "completed")) return false;
      const start = Date.parse(i.startsAt);
      return start >= from && start <= to;
    })
    .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!));
}

export async function loadOutreachReplies({ supabase, company, now }: DashboardCtx): Promise<OutreachReply[]> {
  if (!canAny(company, "outreach.view")) return [];
  const { data, error } = await supabase
    .from("candidate_outreach")
    .select("id, candidate_user_id, responded_at, job_postings(title)")
    .eq("company_id", company.id)
    .eq("status", "interested")
    .gte("responded_at", daysAgo(now, OUTREACH_REPLY_DAYS))
    .order("responded_at", { ascending: true })
    .limit(ATTENTION_FETCH_LIMIT);
  check(error, "the outreach replies");
  const rows = data ?? [];
  const names = await loadCandidateNames(
    supabase,
    rows.map((r) => r.candidate_user_id),
  );
  return rows.map((r) => ({
    id: r.id,
    candidateName: names.get(r.candidate_user_id) ?? "A candidate",
    jobTitle: r.job_postings?.title ?? null,
    respondedAt: r.responded_at as string,
  }));
}

export async function loadScreenings({ supabase, company }: DashboardCtx) {
  if (!canAny(company, "interviews.view")) return [];
  return listScreeningsToReview(supabase, { limit: ATTENTION_FETCH_LIMIT });
}

/**
 * The jobs that may need something (CD-REQ-017): waiting for approval, closing
 * soon or an old draft, with who submitted or made them.
 */
export async function loadAttentionJobs(
  { supabase, company, userId, now }: DashboardCtx,
  timeZone: string | null,
): Promise<AttentionJob[]> {
  const today = todayIn(timeZone, now);
  // A day more than the window: `companyAttentionItems` does the exact cut.
  const until = todayIn(timeZone, new Date(now.getTime() + (CLOSING_SOON_DAYS + 1) * DAY_MS));
  const { data, error } = await scopeToJobs(
    supabase
      .from("job_postings")
      .select("id, title, state, closes_at, created_at")
      .eq("company_id", company.id)
      .is("archived_at", null)
      .or(
        `state.eq.pending_approval,and(state.eq.open,closes_at.gte.${today},closes_at.lte.${until}),and(state.eq.draft,created_at.lt.${daysAgo(now, STALE_DRAFT_DAYS)})`,
      ),
    company,
  )
    .order("created_at", { ascending: true })
    .limit(ATTENTION_JOBS_LIMIT);
  check(error, "the job posts needing attention");
  const jobs = data ?? [];

  const pendingIds = jobs.filter((j) => j.state === "pending_approval").map((j) => j.id);
  const draftIds = jobs.filter((j) => j.state === "draft").map((j) => j.id);

  const [submissions, assignments] = await Promise.all([
    pendingIds.length > 0
      ? supabase
          .from("job_post_state_events")
          .select("job_post_id, actor_user_id, created_at")
          .in("job_post_id", pendingIds)
          .eq("to_state", "pending_approval")
          .order("created_at", { ascending: false })
      : null,
    draftIds.length > 0
      ? supabase.from("company_job_assignments").select("job_post_id, user_id, assigned_by").in("job_post_id", draftIds)
      : null,
  ]);
  check(submissions?.error ?? null, "who sent jobs for approval");
  check(assignments?.error ?? null, "who made the drafts");

  // Newest first: a job's first row is its latest submission.
  const submitted = new Map<string, { actor_user_id: string | null; created_at: string }>();
  for (const event of submissions?.data ?? []) {
    if (!submitted.has(event.job_post_id)) submitted.set(event.job_post_id, event);
  }

  // job_postings has no creator column. A member who isn't an owner is
  // assigned to the job they make, by themselves (RP-REQ-011); a draft with no
  // such row was made by an owner.
  const creators = new Map<string, Set<string>>();
  for (const row of assignments?.data ?? []) {
    if (row.user_id !== row.assigned_by) continue;
    creators.set(row.job_post_id, (creators.get(row.job_post_id) ?? new Set()).add(row.user_id));
  }

  return jobs.map((job) => ({
    id: job.id,
    title: job.title,
    state: job.state,
    closesAt: job.closes_at,
    createdAt: job.created_at,
    submittedAt: submitted.get(job.id)?.created_at ?? null,
    submittedByMe: submitted.get(job.id)?.actor_user_id === userId,
    createdByMe:
      job.state === "draft" &&
      (Boolean(creators.get(job.id)?.has(userId)) || (company.isOwner && !creators.has(job.id))),
  }));
}

/**
 * The template "Resend link" sends with: the one the resend dialog preselects.
 * Null when the member can't resend, or calendars are off.
 */
export async function loadResendTemplateId({ supabase, company }: DashboardCtx): Promise<string | null> {
  if (!calendarEnabled() || !canAny(company, "scheduling.manage")) return null;
  const templates = await loadLinkTemplates(supabase, company.id);
  return templates.find((t) => hasSchedulingLink(t.body))?.id ?? null;
}

export type MoveStage = { id: string; name: string; kind: PipelineStageKind };

export type MoveData = {
  /** Each job's active stages, in position order. */
  stagesByJob: Record<string, MoveStage[]>;
  templates: EmailTemplate[];
  /** Applications with an open AI interview invite, which a move can cancel. */
  openAiInterviews: string[];
};

/** What the inline "Move" needs, for the waiting rows the member may move. */
export async function loadMoveData(
  { supabase, company }: DashboardCtx,
  waiting: { applicationId: string; jobPostId: string }[],
): Promise<MoveData> {
  const none: MoveData = { stagesByJob: {}, templates: [], openAiInterviews: [] };
  const rows = waiting.filter((w) => can(company, "pipeline.move", w.jobPostId));
  const movable = [...new Set(rows.map((w) => w.jobPostId))];
  if (movable.length === 0) return none;

  const { data: jobs, error } = await supabase
    .from("job_postings")
    .select("id, pipeline_id")
    .eq("company_id", company.id)
    .in("id", movable);
  check(error, "the jobs' pipelines");
  const pipelineIds = [...new Set((jobs ?? []).flatMap((j) => (j.pipeline_id ? [j.pipeline_id] : [])))];
  if (pipelineIds.length === 0) return none;

  const [stages, templates, interviews] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, name, kind, pipeline_id")
      .eq("company_id", company.id)
      .in("pipeline_id", pipelineIds)
      .eq("archived", false)
      .order("position", { ascending: true }),
    listTemplates({ supabase, company }),
    // RLS: empty without interviews.view, and the move dialog then doesn't warn.
    supabase
      .from("application_interviews")
      .select("application_id")
      .in(
        "application_id",
        rows.map((w) => w.applicationId),
      )
      .in("status", ["invited", "paused"]),
  ]);
  check(stages.error, "the pipeline stages");
  check(interviews.error, "the open AI interviews");

  const stagesByJob = Object.fromEntries(
    (jobs ?? []).map((job) => [
      job.id,
      (stages.data ?? [])
        .filter((s) => s.pipeline_id === job.pipeline_id)
        .map(({ id, name, kind }) => ({ id, name, kind })),
    ]),
  );
  return { stagesByJob, templates, openAiInterviews: (interviews.data ?? []).map((i) => i.application_id) };
}

/** The jobs that opened in the last 14 days, newest first, that the member can view. */
export async function loadNewJobs({ supabase, company, now }: DashboardCtx): Promise<NewJob[]> {
  if (!canAny(company, "jobs.view")) return [];
  const { data, error } = await scopeToJobs(
    supabase
      .from("job_postings")
      .select("id, title, matching_status, matched_at")
      .eq("company_id", company.id)
      .eq("state", "open")
      .is("archived_at", null)
      .gte("first_opened_at", daysAgo(now, NEW_JOB_DAYS)),
    company,
  )
    .order("first_opened_at", { ascending: false })
    .limit(10);
  check(error, "the new job posts");
  return (data ?? []).map((job) => ({
    id: job.id,
    title: job.title,
    poolMatches: null,
    // `pending` means matching never ran.
    hasMatchingRun: job.matching_status !== "pending" || job.matched_at !== null,
  }));
}

export type PoolSection =
  /** The company has no candidates of its own yet (CD-REQ-022). */
  | { type: "import" }
  | { type: "matches"; jobs: { id: string; title: string; count: number; capped: boolean }[] };

/** CD-REQ-021/022. `newJobs` come back with their counts, for the agent's chips. */
export async function loadPoolSection(
  { supabase, company }: DashboardCtx,
  newJobs: NewJob[],
): Promise<{ section: PoolSection | null; newJobs: NewJob[] }> {
  const canMatch = canAny(company, "talent.view") && canAny(company, "jobs.view");

  if (can(company, "applicants.import")) {
    const { count, error } = await supabase
      .from("company_candidates")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id);
    check(error, "the candidate count");
    if (count === 0) return { section: { type: "import" }, newJobs };
  }
  if (!canMatch) return { section: null, newJobs };

  const checked = newJobs
    .filter((job) => can(company, "talent.view", job.id) && can(company, "jobs.view", job.id))
    .slice(0, POOL_JOBS);
  const counts = new Map<string, number>();
  await Promise.all(
    checked.map(async (job) => {
      const result = await listPoolMatches(supabase, job.id, { limit: POOL_MATCH_LIMIT });
      if (result.ok) counts.set(job.id, result.matches.length);
    }),
  );

  const matched = checked.flatMap((job) => {
    const count = counts.get(job.id) ?? 0;
    return count > 0 ? [{ id: job.id, title: job.title, count, capped: count >= POOL_MATCH_LIMIT }] : [];
  });
  return {
    section: matched.length > 0 ? { type: "matches", jobs: matched } : null,
    newJobs: newJobs.map((job) => ({ ...job, poolMatches: counts.get(job.id) ?? null })),
  };
}

export type NewApplication = {
  id: string;
  name: string;
  jobTitle: string;
  source: string;
  sourceDetail: string | null;
  fitScore: number | null;
  createdAt: string;
};

/** CD-REQ-023: the newest applications still in an applied-kind stage. */
export async function loadNewApplications({ supabase, company }: DashboardCtx): Promise<NewApplication[]> {
  const { data, error } = await supabase
    .from("applications")
    .select(
      `id, created_at, source, source_detail, applicant_user_id, company_candidate_id, user_info(full_name), ${COMPANY_CANDIDATE_PERSON_COLUMNS}, job_postings!inner(id, title), pipeline_stages!inner(kind), application_screenings(fit_score)` as const,
    )
    .eq("job_postings.company_id", company.id)
    // BI-REQ-042: a merged import shows through the application it joined.
    .is("merged_into_application_id", null)
    .eq("pipeline_stages.kind", "applied")
    .order("created_at", { ascending: false })
    .limit(NEW_APPLICATIONS);
  check(error, "the new applications");
  return (data ?? []).map((a) => ({
    id: a.id,
    name: applicationPersonOrNull(a)?.name ?? "Applicant",
    jobTitle: a.job_postings.title,
    source: a.source,
    sourceDetail: a.source_detail,
    fitScore: a.application_screenings?.fit_score ?? null,
    createdAt: a.created_at,
  }));
}

export type OpenJob = {
  id: string;
  title: string;
  state: Database["public"]["Enums"]["job_post_state"];
  linkOnly: boolean;
  /** Null without applicants.view on the job. */
  applicants: { total: number; newThisWeek: number } | null;
};

/**
 * CD-REQ-004/027: open and paused jobs the member can view. The applicant
 * counts come embedded in the one query, not as two more queries per job.
 */
export async function loadOpenJobs({ supabase, company, now }: DashboardCtx): Promise<OpenJob[]> {
  const { data, error } = await scopeToJobs(
    supabase
      .from("job_postings")
      .select("id, title, state, visibility, total:applications(count), recent:applications(count)")
      .eq("company_id", company.id)
      .in("state", ["open", "paused"])
      .is("archived_at", null)
      // BI-REQ-042: a merged import isn't another applicant.
      .is("total.merged_into_application_id", null)
      .is("recent.merged_into_application_id", null)
      .gte("recent.created_at", daysAgo(now, 7)),
    company,
  )
    .order("created_at", { ascending: false })
    .limit(OPEN_JOBS);
  check(error, "the open job posts");

  return (data ?? []).map((job) => ({
    id: job.id,
    title: job.title,
    state: job.state,
    linkOnly: job.visibility === "link_only",
    applicants: can(company, "applicants.view", job.id)
      ? { total: job.total?.[0]?.count ?? 0, newThisWeek: job.recent?.[0]?.count ?? 0 }
      : null,
  }));
}

/**
 * CD-REQ-029: what the setup checklist needs. A step the member can't take
 * isn't read. A read that fails leaves its step out.
 */
export async function loadSetupFacts(
  { supabase, company, userId }: DashboardCtx,
  profile: CompanyProfile | null,
): Promise<SetupFacts> {
  const head = { count: "exact", head: true } as const;
  const exists = async (query: PromiseLike<{ count: number | null; error: { message: string } | null }>, min = 1) => {
    const { count, error } = await query;
    check(error, "the setup checklist");
    return (count ?? 0) >= min;
  };
  const when = (allowed: boolean, name: string, load: () => Promise<boolean>) =>
    allowed ? section(name, load) : Promise.resolve(null);

  const [hasOpenedJob, hasTeammate, calendarConnected, hasCandidates] = await Promise.all([
    when(can(company, "jobs.create"), "the first job step", () =>
      exists(
        supabase.from("job_postings").select("id", head).eq("company_id", company.id).not("first_opened_at", "is", null),
      ),
    ),
    when(can(company, "team.invite"), "the invite step", async () => {
      // The member themself is one row.
      if (await exists(supabase.from("company_members").select("user_id", head).eq("company_id", company.id), 2)) {
        return true;
      }
      return exists(
        supabase
          .from("company_invites")
          .select("id", head)
          .eq("company_id", company.id)
          .eq("company_invite_state", "pending"),
      );
    }),
    when(calendarEnabled(), "the calendar step", () =>
      exists(supabase.from("calendar_connections").select("user_id", head).eq("user_id", userId)),
    ),
    when(can(company, "applicants.import"), "the candidates step", () =>
      exists(supabase.from("company_candidates").select("id", head).eq("company_id", company.id)),
    ),
  ]);

  return {
    profileComplete: profile && Boolean(profile.logoUrl && profile.description?.trim()),
    hasOpenedJob,
    careersPublished: profile && Boolean(profile.careers?.published),
    hasTeammate,
    calendarConnected,
    hasCandidates,
  };
}

const USAGE_KEYS = [
  "interview_minutes",
  "agent_messages",
  "outreach",
  "resume_imports",
] as const satisfies readonly AllowanceKey[];

/** Under this share of an allowance left, its meter is highlighted. */
const LOW_SHARE = 0.2;

export type UsageMeter = {
  key: AllowanceKey;
  /** Null: unlimited. */
  remaining: number | null;
  amount: number | null;
  low: boolean;
};

export type Usage = { planName: string; meters: UsageMeter[] };

/** CD-REQ-031: for members with billing.view only; null otherwise. */
export async function loadUsage({ company }: DashboardCtx): Promise<Usage | null> {
  if (!canViewBilling(company)) return null;
  const { tier, entitlements } = await getEntitlements(company.id);
  return {
    planName: tier.name,
    meters: USAGE_KEYS.flatMap((key) => {
      const { amount, remaining } = entitlements[key];
      // An allowance the plan doesn't include has nothing to meter.
      if (amount === 0) return [];
      const low = amount !== null && remaining !== null && remaining < amount * LOW_SHARE;
      return [{ key, amount, remaining, low }];
    }),
  };
}
