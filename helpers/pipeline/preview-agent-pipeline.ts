import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import type { Database } from "@/utils/types/database.types";
import { MAX_PIPELINES_PER_COMPANY, PIPELINE_NAME_MAX } from "./config";
import { pipelineReasonCopy } from "./copy";
import { listPipelines, previewJobPipelineSwitch } from "./pipelines";

// The approval previews for the recruiter agent's `setJobPipeline` and
// `customizeJobPipeline` (JPT-041, JP-TEST-006). The agent's card
// (PipelineApprovalDetails) and the MCP confirmation both format these, so
// both surfaces show the same facts. Reads only.

type Ctx = { supabase: SupabaseClient<Database>; company: Pick<MyCompany, "id"> };

/** The tool's mapping as pairs (models handle arrays better than uuid-keyed objects). */
export type StageMappingPair = { fromStageId: string; toStageId: string };

/** `[{ fromStageId, toStageId }]` → `{ "<old stage id>": "<new stage id>" }`, or undefined when empty. */
export function mappingFromPairs(pairs: StageMappingPair[] | undefined): Record<string, string> | undefined {
  if (!pairs || pairs.length === 0) return undefined;
  return Object.fromEntries(pairs.map((p) => [p.fromStageId, p.toStageId]));
}

const switchInput = z.object({
  jobPostId: z.string().uuid(),
  pipelineId: z.string().uuid(),
  mapping: z.array(z.object({ fromStageId: z.string().uuid(), toStageId: z.string().uuid() })).optional(),
});

export type PipelineSwitchMove = {
  stage: string;
  applications: number;
  planItems: number;
  /** The new pipeline's stage it lands in. */
  to: string;
};

export type AgentPipelineSwitchPreview =
  | {
      ok: true;
      jobTitle: string;
      from: string;
      to: string;
      /** Each of the job's stages that holds applications or plan items, and where it goes. */
      moves: PipelineSwitchMove[];
      applications: number;
    }
  | { ok: false; error: string };

const INVALID = { ok: false, error: "Couldn't read the proposed switch." } as const;

/**
 * What `setJobPipeline` would do with this input: the default mapping with
 * the agent's pairs applied on top, checked the way the RPC checks it (same
 * candidate status, every stage in use mapped). Never writes.
 */
export async function previewAgentJobPipelineSwitch(ctx: Ctx, input: unknown): Promise<AgentPipelineSwitchPreview> {
  const parsed = switchInput.safeParse(input);
  if (!parsed.success) return INVALID;
  const { jobPostId, pipelineId, mapping } = parsed.data;

  const preview = await previewJobPipelineSwitch(ctx, { jobPostId, pipelineId });
  if (!preview.ok) return { ok: false, error: preview.error };
  if (preview.same) return { ok: false, error: `This job already uses ${preview.to.name}.` };

  const rows = new Map(preview.rows.map((row) => [row.stage.id, row]));
  const chosen: Record<string, string> = { ...preview.mapping };
  for (const { fromStageId, toStageId } of mapping ?? []) {
    const row = rows.get(fromStageId);
    if (!row) return { ok: false, error: "A stage in the mapping isn't in this job's pipeline." };
    if (!row.options.some((option) => option.id === toStageId)) {
      return { ok: false, error: pipelineReasonCopy("status_mismatch", { stage: row.stage }) };
    }
    chosen[fromStageId] = toStageId;
  }

  const moves: PipelineSwitchMove[] = [];
  let applications = 0;
  for (const row of preview.rows) {
    if (!row.inUse) continue;
    const target = row.options.find((option) => option.id === chosen[row.stage.id]);
    if (!target) {
      return { ok: false, error: pipelineReasonCopy("missing_status", { stage: row.stage, status: row.status }) };
    }
    moves.push({ stage: row.stage.name, applications: row.applications, planItems: row.planItems, to: target.name });
    applications += row.applications;
  }

  return { ok: true, jobTitle: preview.job.title, from: preview.from.name, to: preview.to.name, moves, applications };
}

const customizeInput = z.object({ jobPostId: z.string().uuid() });

export type AgentCustomizePipelinePreview =
  | {
      ok: true;
      jobTitle: string;
      /** The pipeline the job uses now, which is copied. */
      from: string;
      /** The copy's name before a clash suffix (the RPC adds " (2)" when taken). */
      name: string;
      stages: number;
      /** Jobs that stay on `from`. */
      otherJobs: number;
    }
  | { ok: false; error: string };

/**
 * What `customizeJobPipeline` would do: copy the job's pipeline as
 * "<job title>" and move the job onto it stage for stage. Never writes.
 */
export async function previewAgentCustomizeJobPipeline(
  ctx: Ctx,
  input: unknown,
): Promise<AgentCustomizePipelinePreview> {
  const parsed = customizeInput.safeParse(input);
  if (!parsed.success) return INVALID;

  const { data: job, error } = await ctx.supabase
    .from("job_postings")
    .select("id, title, pipeline_id")
    .eq("id", parsed.data.jobPostId)
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) return { ok: false, error: "Failed to load the job." };
  if (!job) return { ok: false, error: pipelineReasonCopy("not_found") };

  let pipelines;
  try {
    pipelines = await listPipelines(ctx);
  } catch {
    return { ok: false, error: "Failed to load the pipelines." };
  }
  const current = pipelines.find((p) => p.id === job.pipeline_id);
  if (!current) return { ok: false, error: pipelineReasonCopy("pipeline_not_found") };
  if (pipelines.length >= MAX_PIPELINES_PER_COMPANY) {
    return { ok: false, error: pipelineReasonCopy("limit_reached") };
  }

  return {
    ok: true,
    jobTitle: job.title,
    from: current.name,
    // fork_job_pipeline's base name: the trimmed title, "Job" when empty, cut to the limit.
    name: (job.title.trim() || "Job").slice(0, PIPELINE_NAME_MAX).trim(),
    stages: current.activeStages,
    otherJobs: Math.max(0, current.jobs - 1),
  };
}
