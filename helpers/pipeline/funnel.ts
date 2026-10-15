import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { Constants, type Database } from "@/utils/types/database.types";
import type { PipelineStageKind } from "./status-map";

/** PL-REQ-011: an application waiting in Applied this long, untouched, needs attention. */
export const NEEDS_ATTENTION_DAYS = 3;
const NEEDS_ATTENTION_LIMIT = 20;
const DAY_MS = 86_400_000;

/** The funnel's steps, in order. Rejected and On hold sit outside it. */
const PROGRESS_KINDS = new Set<PipelineStageKind>([
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
]);

const RpcFunnel = z.object({
  stages: z.array(
    z.object({
      stage_id: z.string(),
      name: z.string(),
      kind: z.enum(Constants.public.Enums.pipeline_stage_kind),
      count: z.number(),
      reached: z.number(),
      median_days: z.number().nullable(),
    }),
  ),
  sources: z.record(z.string(), z.number()),
  time_to_hire_days: z.number().nullable(),
  total: z.number(),
});

export type FunnelStage = {
  stageId: string;
  name: string;
  kind: PipelineStageKind;
  /** Applications in the stage now. */
  count: number;
  /** Applications that were ever in it. */
  reached: number;
  /** Share of the previous funnel step's applications that reached this one, or null. */
  conversion: number | null;
  medianDays: number | null;
};

export type JobFunnel = {
  stages: FunnelStage[];
  sources: Record<string, number>;
  timeToHireDays: number | null;
  total: number;
};

/**
 * The funnel for one job (PL-TASK-050) through `get_job_funnel`. Null when
 * the job isn't the caller's company's. Throws on an RPC error.
 */
export async function getJobFunnel(
  supabase: SupabaseClient<Database>,
  jobPostId: string,
): Promise<JobFunnel | null> {
  const { data, error } = await supabase.rpc("get_job_funnel", {
    p_job_post_id: jobPostId,
  });
  if (error) throw new Error(`Failed to load the funnel: ${error.message}`);
  if (data === null) return null;
  const funnel = RpcFunnel.parse(data);

  let previousReached: number | null = null;
  const stages = funnel.stages.map((s): FunnelStage => {
    let conversion: number | null = null;
    if (PROGRESS_KINDS.has(s.kind)) {
      // Never NaN or Infinity: no previous step, or nobody reached it.
      conversion = previousReached ? s.reached / previousReached : null;
      previousReached = s.reached;
    }
    return {
      stageId: s.stage_id,
      name: s.name,
      kind: s.kind,
      count: s.count,
      reached: s.reached,
      conversion,
      medianDays: s.median_days,
    };
  });

  return {
    stages,
    sources: funnel.sources,
    timeToHireDays: funnel.time_to_hire_days,
    total: funnel.total,
  };
}

export type NeedsAttention = {
  applicationId: string;
  name: string;
  jobPostId: string;
  jobTitle: string;
  daysInApplied: number;
};

export type CompanyFunnel = {
  /** Stage counts summed across the active jobs, in stage order. */
  stages: {
    stageId: string;
    name: string;
    kind: PipelineStageKind;
    count: number;
  }[];
  jobs: {
    jobPostId: string;
    title: string;
    total: number;
    stages: FunnelStage[];
  }[];
  needsAttention: NeedsAttention[];
};

/**
 * The dashboard's view (PL-REQ-011): every active job's funnel, the totals,
 * and the applications waiting in Applied for more than 3 days with no event
 * since they got there.
 */
export async function getCompanyFunnel(
  {
    supabase,
    company,
  }: { supabase: SupabaseClient<Database>; company: MyCompany },
  now: Date = new Date(),
): Promise<CompanyFunnel> {
  const { data: jobs, error } = await supabase
    .from("job_postings")
    .select("id, title")
    .eq("company_id", company.id)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load the jobs: ${error.message}`);

  const funnels = await Promise.all(
    (jobs ?? []).map((job) => getJobFunnel(supabase, job.id)),
  );

  const totals = new Map<string, CompanyFunnel["stages"][number]>();
  const perJob: CompanyFunnel["jobs"] = [];
  (jobs ?? []).forEach((job, i) => {
    const funnel = funnels[i];
    if (!funnel) return;
    perJob.push({
      jobPostId: job.id,
      title: job.title,
      total: funnel.total,
      stages: funnel.stages,
    });
    for (const s of funnel.stages) {
      const entry = totals.get(s.stageId) ?? {
        stageId: s.stageId,
        name: s.name,
        kind: s.kind,
        count: 0,
      };
      entry.count += s.count;
      totals.set(s.stageId, entry);
    }
  });

  return {
    stages: [...totals.values()],
    jobs: perJob,
    needsAttention: await loadNeedsAttention(supabase, company, now),
  };
}

async function loadNeedsAttention(
  supabase: SupabaseClient<Database>,
  company: MyCompany,
  now: Date,
): Promise<NeedsAttention[]> {
  const cutoff = new Date(
    now.getTime() - NEEDS_ATTENTION_DAYS * DAY_MS,
  ).toISOString();
  const { data: apps, error } = await supabase
    .from("applications")
    .select(
      "id, stage_entered_at, user_info(full_name), job_postings!inner(id, title, company_id), pipeline_stages!inner(kind)",
    )
    .eq("job_postings.company_id", company.id)
    .eq("pipeline_stages.kind", "applied")
    .lt("stage_entered_at", cutoff)
    .order("stage_entered_at", { ascending: true })
    .limit(NEEDS_ATTENTION_LIMIT * 2);
  if (error)
    throw new Error(`Failed to load waiting applications: ${error.message}`);
  if (!apps || apps.length === 0) return [];

  const { data: events, error: eventsError } = await supabase
    .from("application_events")
    .select("application_id, type, created_at")
    .in(
      "application_id",
      apps.map((a) => a.id),
    )
    .neq("type", "applied");
  if (eventsError)
    throw new Error(`Failed to load events: ${eventsError.message}`);

  const enteredAt = new Map(apps.map((a) => [a.id, a.stage_entered_at]));
  const touched = new Set(
    (events ?? [])
      .filter(
        (e) =>
          e.type !== "applied" &&
          e.application_id &&
          e.created_at > enteredAt.get(e.application_id)!,
      )
      .map((e) => e.application_id),
  );

  return apps
    .filter((a) => !touched.has(a.id))
    .slice(0, NEEDS_ATTENTION_LIMIT)
    .map((a) => ({
      applicationId: a.id,
      name: a.user_info?.full_name?.trim() || "Applicant",
      jobPostId: a.job_postings.id,
      jobTitle: a.job_postings.title,
      daysInApplied: Math.floor(
        (now.getTime() - Date.parse(a.stage_entered_at)) / DAY_MS,
      ),
    }));
}
