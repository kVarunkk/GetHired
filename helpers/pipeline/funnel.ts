import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { Constants, type Database } from "@/utils/types/database.types";
import { STAGE_KIND_LABELS, type PipelineStageKind } from "./status-map";

/**
 * PL-REQ-011: an application waiting in Applied this long, untouched, needs
 * attention. `get_company_funnel` and `company_dashboard_summary` use the same
 * number.
 */
export const NEEDS_ATTENTION_DAYS = 3;
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
  return toJobFunnel(RpcFunnel.parse(data));
}

function toJobFunnel(funnel: z.infer<typeof RpcFunnel>): JobFunnel {
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
  /**
   * Counts summed across the active jobs by stage kind (JP-REQ-010: jobs on
   * other pipelines share no stage ids), named by the kind, in kind order.
   * `stageId` is the kind: these rows have no single stage.
   */
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

const RpcCompanyFunnel = z.object({
  stages: z.array(
    z.object({
      kind: z.enum(Constants.public.Enums.pipeline_stage_kind),
      count: z.number(),
    }),
  ),
  jobs: z.array(
    z.object({ job_post_id: z.string(), title: z.string(), funnel: RpcFunnel }),
  ),
  needs_attention: z.array(
    z.object({
      application_id: z.string(),
      name: z.string(),
      job_post_id: z.string(),
      job_title: z.string(),
      stage_entered_at: z.string(),
    }),
  ),
});

/**
 * The company's view (PL-REQ-011), in one `get_company_funnel` call
 * (CD-REQ-026): every active job's funnel, the totals, and the applications
 * waiting in Applied for more than 3 days with no event since they got there.
 * The database takes the company from the session and counts only the jobs
 * the member may view. Throws on an RPC error.
 */
export async function getCompanyFunnel(
  { supabase }: { supabase: SupabaseClient<Database>; company: MyCompany },
  now: Date = new Date(),
): Promise<CompanyFunnel> {
  const { data, error } = await supabase.rpc("get_company_funnel");
  if (error) throw new Error(`Failed to load the funnel: ${error.message}`);
  if (data === null) return { stages: [], jobs: [], needsAttention: [] };
  const funnel = RpcCompanyFunnel.parse(data);

  const totals = new Map(funnel.stages.map((s) => [s.kind, s.count]));
  return {
    stages: Constants.public.Enums.pipeline_stage_kind.flatMap((kind) => {
      const count = totals.get(kind);
      return count === undefined
        ? []
        : [{ stageId: kind, name: STAGE_KIND_LABELS[kind], kind, count }];
    }),
    jobs: funnel.jobs.map((job) => {
      const { total, stages } = toJobFunnel(job.funnel);
      return { jobPostId: job.job_post_id, title: job.title, total, stages };
    }),
    needsAttention: funnel.needs_attention.map((row) => ({
      applicationId: row.application_id,
      name: row.name,
      jobPostId: row.job_post_id,
      jobTitle: row.job_title,
      daysInApplied: Math.floor(
        (now.getTime() - Date.parse(row.stage_entered_at)) / DAY_MS,
      ),
    })),
  };
}
