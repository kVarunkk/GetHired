import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import type { Database, Json, Tables } from "@/utils/types/database.types";
import { PIPELINE_NAME_MAX } from "./config";
import { pipelineReasonCopy, type RefusedStage } from "./copy";
import { listPipelineStages, type PipelineStage } from "./stages";
import { statusForKind, type ApplicationStatus, type PipelineStageKind } from "./status-map";

// Pipelines per company (plan/job-pipelines/feature-job-pipelines-spec.md §3.1).
// Every write goes through a security-definer RPC that checks the permission
// and returns `{ ok, reason }`; these helpers validate, call it and turn the
// reason into copy (`helpers/pipeline/copy.ts`).

type Ctx = { supabase: SupabaseClient<Database>; company: Pick<MyCompany, "id"> };

export type CompanyPipeline = Tables<"company_pipelines">;

export type PipelineSummary = Pick<CompanyPipeline, "id" | "name" | "is_default" | "archived"> & {
  /** Jobs on this pipeline, open and closed (JP-REQ-008's "Used by N jobs"). */
  jobs: number;
  openJobs: number;
  closedJobs: number;
  activeStages: number;
};

export type PipelineFailure = {
  ok: false;
  reason: string;
  error: string;
  stage?: RefusedStage | null;
  status?: ApplicationStatus | null;
  jobs?: number;
};

const failure = (
  reason: string,
  detail: Parameters<typeof pipelineReasonCopy>[1] = {},
): PipelineFailure => ({
  ok: false,
  reason,
  error: pipelineReasonCopy(reason, detail),
  ...(detail.stage !== undefined ? { stage: detail.stage } : {}),
  ...(detail.status !== undefined ? { status: detail.status } : {}),
  ...(detail.jobs !== undefined ? { jobs: detail.jobs } : {}),
});

const NOT_FOUND = failure("pipeline_not_found");

type RpcResult = {
  ok?: boolean;
  reason?: string;
  jobs?: number;
  stage?: RefusedStage;
  status?: ApplicationStatus;
  pipeline_id?: string;
  name?: string;
  changed?: boolean;
  moved?: number;
  plan_items?: number;
  mapping?: Record<string, string>;
};

const asResult = (data: unknown): RpcResult =>
  data && typeof data === "object" && !Array.isArray(data) ? (data as RpcResult) : {};

function refused(result: RpcResult, permission: "settings.stages" | "jobs.edit"): PipelineFailure {
  return failure(result.reason ?? "unknown", {
    permission,
    jobs: result.jobs,
    stage: result.stage,
    status: result.status,
  });
}

function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= PIPELINE_NAME_MAX ? trimmed : null;
}

const validId = (id: unknown): id is string => typeof id === "string" && isUuid(id);

/**
 * The company's pipelines (active ones, archived too with `includeArchived`),
 * default first then by name, with how many jobs use each and its active
 * stage count. Throws on a database error.
 */
export async function listPipelines(
  { supabase, company }: Ctx,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<PipelineSummary[]> {
  let query = supabase
    .from("company_pipelines")
    .select("id, name, is_default, archived")
    .eq("company_id", company.id);
  if (!includeArchived) query = query.eq("archived", false);
  const { data: pipelines, error } = await query.order("name", { ascending: true });
  if (error) throw new Error(`Failed to load the pipelines: ${error.message}`);
  const rows = pipelines ?? [];
  if (rows.length === 0) return [];
  const ids = rows.map((p) => p.id);

  const [jobs, stages] = await Promise.all([
    supabase.from("job_postings").select("pipeline_id, status").eq("company_id", company.id).in("pipeline_id", ids),
    supabase
      .from("pipeline_stages")
      .select("pipeline_id")
      .eq("company_id", company.id)
      .in("pipeline_id", ids)
      .eq("archived", false),
  ]);
  if (jobs.error) throw new Error(`Failed to count the pipelines' jobs: ${jobs.error.message}`);
  if (stages.error) throw new Error(`Failed to count the pipelines' stages: ${stages.error.message}`);

  const open = new Map<string, number>();
  const closed = new Map<string, number>();
  for (const job of jobs.data ?? []) {
    if (!job.pipeline_id) continue;
    const counts = job.status === "active" ? open : closed;
    counts.set(job.pipeline_id, (counts.get(job.pipeline_id) ?? 0) + 1);
  }
  const stageCounts = new Map<string, number>();
  for (const stage of stages.data ?? []) {
    stageCounts.set(stage.pipeline_id, (stageCounts.get(stage.pipeline_id) ?? 0) + 1);
  }

  return rows
    .map((p) => {
      const openJobs = open.get(p.id) ?? 0;
      const closedJobs = closed.get(p.id) ?? 0;
      return {
        ...p,
        jobs: openJobs + closedJobs,
        openJobs,
        closedJobs,
        activeStages: stageCounts.get(p.id) ?? 0,
      };
    })
    .sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

/** A copy of `fromPipelineId`'s active stages (the default pipeline's when omitted) under `name`. */
export async function createPipeline(
  { supabase }: Ctx,
  { name, fromPipelineId }: { name: string; fromPipelineId?: string },
): Promise<{ ok: true; pipelineId: string } | PipelineFailure> {
  const clean = cleanName(name);
  if (!clean) return failure("invalid_name");
  if (fromPipelineId !== undefined && !validId(fromPipelineId)) return NOT_FOUND;

  const { data, error } = await supabase.rpc("create_pipeline", {
    p_name: clean,
    ...(fromPipelineId ? { p_from_pipeline: fromPipelineId } : {}),
  });
  if (error) return { ok: false, reason: "error", error: "Failed to create the pipeline." };
  const result = asResult(data);
  if (!result.ok || !result.pipeline_id) return refused(result, "settings.stages");
  return { ok: true, pipelineId: result.pipeline_id };
}

export async function renamePipeline(
  { supabase }: Ctx,
  { pipelineId, name }: { pipelineId: string; name: string },
): Promise<{ ok: true } | PipelineFailure> {
  if (!validId(pipelineId)) return NOT_FOUND;
  const clean = cleanName(name);
  if (!clean) return failure("invalid_name");

  const { data, error } = await supabase.rpc("rename_pipeline", { p_pipeline_id: pipelineId, p_name: clean });
  if (error) return { ok: false, reason: "error", error: "Failed to rename the pipeline." };
  const result = asResult(data);
  return result.ok ? { ok: true } : refused(result, "settings.stages");
}

/** New jobs get the default; the old default stops being one in the same call. */
export async function setDefaultPipeline(
  { supabase }: Ctx,
  { pipelineId }: { pipelineId: string },
): Promise<{ ok: true } | PipelineFailure> {
  if (!validId(pipelineId)) return NOT_FOUND;
  const { data, error } = await supabase.rpc("set_default_pipeline", { p_pipeline_id: pipelineId });
  if (error) return { ok: false, reason: "error", error: "Failed to change the default pipeline." };
  const result = asResult(data);
  return result.ok ? { ok: true } : refused(result, "settings.stages");
}

/** Refused for the default pipeline and one that any job, open or closed, uses (JP-REQ-008). */
export async function archivePipeline(
  { supabase }: Ctx,
  { pipelineId }: { pipelineId: string },
): Promise<{ ok: true } | PipelineFailure> {
  if (!validId(pipelineId)) return NOT_FOUND;
  const { data, error } = await supabase.rpc("archive_pipeline", { p_pipeline_id: pipelineId });
  if (error) return { ok: false, reason: "error", error: "Failed to archive the pipeline." };
  const result = asResult(data);
  return result.ok ? { ok: true } : refused(result, "settings.stages");
}

export type PipelineSwitchResult = {
  ok: true;
  changed: boolean;
  /** Applications moved to a stage of the new pipeline (merged ones included). */
  moved: number;
  planItems: number;
  mapping: Record<string, string>;
};

const switchResult = (result: RpcResult): PipelineSwitchResult => ({
  ok: true,
  changed: result.changed ?? false,
  moved: result.moved ?? 0,
  planItems: result.plan_items ?? 0,
  mapping: result.mapping ?? {},
});

/** `{ "<old stage id>": "<new stage id>" }`, every id a uuid. */
function validMapping(mapping: unknown): mapping is Record<string, string> {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return false;
  return Object.entries(mapping).every(([from, to]) => isUuid(from) && validId(to));
}

/**
 * JP-REQ-006: moves the job and every application to `pipelineId`. Stages
 * missing from `mapping` take the default (same kind, then the same candidate
 * status). Never changes a candidate's status and never emails.
 */
export async function setJobPipeline(
  { supabase }: Ctx,
  { jobPostId, pipelineId, mapping }: { jobPostId: string; pipelineId: string; mapping?: Record<string, string> },
): Promise<PipelineSwitchResult | PipelineFailure> {
  if (!validId(jobPostId)) return failure("not_found");
  if (!validId(pipelineId)) return NOT_FOUND;
  if (mapping !== undefined && !validMapping(mapping)) return failure("invalid_mapping");

  const { data, error } = await supabase.rpc("set_job_pipeline", {
    p_job_post_id: jobPostId,
    p_pipeline_id: pipelineId,
    ...(mapping ? { p_mapping: mapping as Json } : {}),
  });
  if (error) return { ok: false, reason: "error", error: "Failed to switch the job's pipeline." };
  const result = asResult(data);
  return result.ok ? switchResult(result) : refused(result, "jobs.edit");
}

/** JP-REQ-007: copies the job's pipeline as "<job title>" and moves the job onto it stage for stage. */
export async function forkJobPipeline(
  { supabase }: Ctx,
  { jobPostId }: { jobPostId: string },
): Promise<(PipelineSwitchResult & { pipelineId: string; name: string }) | PipelineFailure> {
  if (!validId(jobPostId)) return failure("not_found");
  const { data, error } = await supabase.rpc("fork_job_pipeline", { p_job_post_id: jobPostId });
  if (error) return { ok: false, reason: "error", error: "Failed to customize the job's pipeline." };
  const result = asResult(data);
  if (!result.ok || !result.pipeline_id) return refused(result, "settings.stages");
  return { ...switchResult(result), pipelineId: result.pipeline_id, name: result.name ?? "" };
}

// ------------------------------------------------------------ switch preview

type StageOption = Pick<PipelineStage, "id" | "name" | "kind">;

export type SwitchPreviewRow = {
  stage: Pick<PipelineStage, "id" | "name" | "kind" | "archived">;
  /** What candidates in this stage see; a target must show the same. */
  status: ApplicationStatus;
  /** Applications in the stage (merged ones left out, as on the board). */
  applications: number;
  planItems: number;
  /** Whether the switch has to move something out of this stage. */
  inUse: boolean;
  /** The new pipeline's stages a row can map to (same candidate status). */
  options: StageOption[];
  /** What `set_job_pipeline` picks without a mapping; null when nothing fits. */
  defaultTargetId: string | null;
};

export type JobPipelineSwitchPreview = {
  ok: true;
  job: { id: string; title: string };
  from: { id: string; name: string };
  to: { id: string; name: string };
  /** The job is already on `to`: saving changes nothing. */
  same: boolean;
  rows: SwitchPreviewRow[];
  /** The default mapping for the rows in use. */
  mapping: Record<string, string>;
  /** Rows in use with no stage of their status in the new pipeline; the switch is refused. */
  missing: { stage: RefusedStage; status: ApplicationStatus }[];
};

/** The SQL default: same candidate status, the same kind first, then by position. */
function defaultTarget(kind: PipelineStageKind, targets: PipelineStage[]): PipelineStage | null {
  const status = statusForKind(kind);
  const fits = targets.filter((t) => statusForKind(t.kind) === status);
  return fits.find((t) => t.kind === kind) ?? fits[0] ?? null;
}

/**
 * JP-REQ-006's mapping table for moving `jobPostId` to `pipelineId`: each of
 * the job's current stages with its counts, the stages it can map to and the
 * default, and the statuses the new pipeline lacks. Reads only.
 */
export async function previewJobPipelineSwitch(
  ctx: Ctx,
  { jobPostId, pipelineId }: { jobPostId: string; pipelineId: string },
): Promise<JobPipelineSwitchPreview | PipelineFailure> {
  if (!validId(jobPostId)) return failure("not_found");
  if (!validId(pipelineId)) return NOT_FOUND;
  const { supabase, company } = ctx;

  const { data: job, error: jobError } = await supabase
    .from("job_postings")
    .select("id, title, pipeline_id")
    .eq("id", jobPostId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (jobError) return { ok: false, reason: "error", error: "Failed to load the job." };
  if (!job) return failure("not_found");
  if (!job.pipeline_id) return NOT_FOUND;

  const { data: pipelines, error: pipelinesError } = await supabase
    .from("company_pipelines")
    .select("id, name, archived")
    .eq("company_id", company.id)
    .in("id", [job.pipeline_id, pipelineId]);
  if (pipelinesError) return { ok: false, reason: "error", error: "Failed to load the pipelines." };
  const from = pipelines?.find((p) => p.id === job.pipeline_id);
  const to = pipelines?.find((p) => p.id === pipelineId);
  if (!from || !to || to.archived) return NOT_FOUND;

  let current: PipelineStage[];
  let targets: PipelineStage[];
  try {
    [current, targets] = await Promise.all([
      listPipelineStages(ctx, from.id, { includeArchived: true }),
      listPipelineStages(ctx, to.id),
    ]);
  } catch {
    return { ok: false, reason: "error", error: "Failed to load the pipeline stages." };
  }

  const [apps, items] = await Promise.all([
    supabase.from("applications").select("stage_id, merged_into_application_id").eq("job_post_id", job.id),
    supabase.from("job_interview_plan_items").select("stage_id").eq("job_post_id", job.id),
  ]);
  if (apps.error || items.error) {
    return { ok: false, reason: "error", error: "Failed to count the job's applications." };
  }

  const shown = new Map<string, number>();
  const used = new Set<string>();
  for (const app of apps.data ?? []) {
    if (!app.stage_id) continue;
    used.add(app.stage_id);
    if (!app.merged_into_application_id) shown.set(app.stage_id, (shown.get(app.stage_id) ?? 0) + 1);
  }
  const planItems = new Map<string, number>();
  for (const item of items.data ?? []) {
    used.add(item.stage_id);
    planItems.set(item.stage_id, (planItems.get(item.stage_id) ?? 0) + 1);
  }

  const same = from.id === to.id;
  const rows: SwitchPreviewRow[] = current
    .filter((s) => !s.archived || used.has(s.id))
    .map((s) => {
      const status = statusForKind(s.kind);
      return {
        stage: { id: s.id, name: s.name, kind: s.kind, archived: s.archived },
        status,
        applications: shown.get(s.id) ?? 0,
        planItems: planItems.get(s.id) ?? 0,
        inUse: used.has(s.id),
        options: targets
          .filter((t) => statusForKind(t.kind) === status)
          .map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
        defaultTargetId: defaultTarget(s.kind, targets)?.id ?? null,
      };
    });

  const mapping: Record<string, string> = {};
  const missing: JobPipelineSwitchPreview["missing"] = [];
  if (!same) {
    for (const row of rows) {
      if (!row.inUse) continue;
      if (row.defaultTargetId) mapping[row.stage.id] = row.defaultTargetId;
      else missing.push({ stage: { id: row.stage.id, name: row.stage.name, kind: row.stage.kind }, status: row.status });
    }
  }

  return {
    ok: true,
    job: { id: job.id, title: job.title },
    from: { id: from.id, name: from.name },
    to: { id: to.id, name: to.name },
    same,
    rows,
    mapping,
    missing,
  };
}
