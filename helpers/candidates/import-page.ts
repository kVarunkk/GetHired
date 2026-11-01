import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny } from "@/helpers/companies/permissions";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { listTalentLists } from "@/helpers/pipeline/talent-lists";
import { listImportJobs } from "./candidates-tab";

/** A job's AI interview, when it invites by fit score (BI-REQ-015b). */
export type ImportJobInterview = { fitThreshold: number; durationMinutes: number };

/** A job people can be imported into. */
export type ImportJob = { id: string; title: string; interview: ImportJobInterview | null };

export type ImportPage = {
  /** Active jobs the member can import into, with the interview rule shown by the auto-invite switch. */
  jobs: ImportJob[];
  /** The company's open pipeline stages, in order. */
  stages: { id: string; name: string }[];
  /** The company's talent lists; null without talent_lists.manage. */
  lists: { id: string; name: string; slug: string }[] | null;
  /** The pool with no job (CP-REQ-004's `canUsePool`) needs applicants.import for every job (BI-PERM-001). */
  allowNoJob: boolean;
  /** `screenings` left this period; null when unlimited or unknown (BI-REQ-018). */
  screeningsRemaining: number | null;
  /** The job a job page imports into (CP-REQ-010); null on the Candidates pages. */
  fixedJob: ImportJob | null;
  /**
   * A job id was given that the member can't import into: a 404 on the job
   * pages. The Candidates pages ignore it; the rest is the no-job page.
   */
  notFound: boolean;
};

const STAGE_COLUMNS = "id, name" as const;

/** The interview rule the auto-invite switch shows, from a job's config row. */
function interviewOf(c: {
  enabled: boolean;
  invite_rule: string;
  fit_threshold: number | null;
  duration_minutes: number;
}): ImportJobInterview | null {
  return c.enabled && c.invite_rule === "fit_threshold" && c.fit_threshold !== null
    ? { fitThreshold: c.fit_threshold, durationMinutes: c.duration_minutes }
    : null;
}

/** `jobId` when it's the company's and the member can import into it, else null. Any status. */
async function loadFixedJob(
  supabase: SupabaseClient<Database>,
  company: MyCompany,
  jobId: string,
): Promise<{ id: string; title: string } | null> {
  if (!can(company, "applicants.import", jobId)) return null;
  const { data, error } = await supabase
    .from("job_postings")
    .select("id, title")
    .eq("id", jobId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * What every import method needs (BI-REQ-009–018, CP-REQ-010), or null when
 * the member can't import anyone. With `jobId` (a job page) it's that job,
 * shown as `fixedJob`; `notFound` when the member can't import into it. The
 * stages, lists, interview configs (read through RLS: interviews.view) and
 * the allowance are extras: an error leaves them out.
 */
export async function loadImportPage(
  supabase: SupabaseClient<Database>,
  company: MyCompany,
  { jobId }: { jobId?: string | null } = {},
): Promise<ImportPage | null> {
  if (!canAny(company, "applicants.import")) return null;
  const allowNoJob = can(company, "applicants.import");
  const canList = can(company, "talent_lists.manage");

  const [jobs, fixed] = await Promise.all([
    listImportJobs(supabase, company),
    jobId ? loadFixedJob(supabase, company, jobId) : Promise.resolve(null),
  ]);
  const notFound = !!jobId && !fixed;
  if (!fixed && !allowNoJob && jobs.length === 0) return null;

  const configJobs = [...new Set([...jobs.map((j) => j.id), ...(fixed ? [fixed.id] : [])])];
  const [{ data: stages }, { data: configs }, lists, screeningsRemaining] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select(STAGE_COLUMNS)
      .eq("company_id", company.id)
      .eq("archived", false)
      .order("position", { ascending: true }),
    configJobs.length > 0
      ? supabase
          .from("job_interview_configs")
          .select("job_post_id, enabled, invite_rule, fit_threshold, duration_minutes")
          .in("job_post_id", configJobs)
      : Promise.resolve({ data: [] }),
    canList ? listTalentLists({ supabase, company }).catch(() => []) : Promise.resolve(null),
    getEntitlements(company.id)
      .then((e) => e.entitlements.screenings.remaining)
      .catch(() => null),
  ]);

  const interviews = new Map<string, ImportJobInterview>();
  for (const c of configs ?? []) {
    const interview = interviewOf(c);
    if (interview) interviews.set(c.job_post_id, interview);
  }

  return {
    jobs: jobs.map((j) => ({ ...j, interview: interviews.get(j.id) ?? null })),
    stages: stages ?? [],
    lists: lists && lists.map((l) => ({ id: l.id, name: l.name, slug: l.slug })),
    allowNoJob,
    screeningsRemaining,
    fixedJob: fixed ? { ...fixed, interview: interviews.get(fixed.id) ?? null } : null,
    notFound,
  };
}
