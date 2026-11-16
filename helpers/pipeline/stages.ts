import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import { createClient } from "@/lib/supabase/server";
import { Constants, type Database, type Tables } from "@/utils/types/database.types";
import { MAX_ACTIVE_STAGES, MAX_STAGE_NAME } from "./config";
import { PIPELINE_NOT_FOUND } from "./copy";
import type { PipelineStageKind } from "./status-map";

export { MAX_ACTIVE_STAGES, MAX_STAGE_NAME } from "./config";

export type PipelineStage = Tables<"pipeline_stages">;

type Ctx = { supabase: SupabaseClient<Database>; company: Pick<MyCompany, "id"> };
type Result = { ok: true } | { ok: false; error: string };

/**
 * Which pipeline's stages (job pipelines, JP-REQ-003): a job's, a named one,
 * or, with neither, the company's default (what the settings page and the
 * agent's stage tools edit until they take a pipeline).
 */
export type StageScope = { pipelineId?: string; jobPostId?: string };

/** Kinds every pipeline keeps: where applications start, and the two outcomes. */
export const PROTECTED_KINDS: ReadonlySet<PipelineStageKind> = new Set([
  "applied",
  "hired",
  "rejected",
]);

const KINDS = new Set<string>(Constants.public.Enums.pipeline_stage_kind);
const NOT_FOUND = { ok: false, error: "Stage not found." } as const;

function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_STAGE_NAME ? trimmed : null;
}

const NAME_ERROR = `Stage names are 1 to ${MAX_STAGE_NAME} characters.`;

/**
 * The session company's pipeline for `scope`, or null when the job or the
 * pipeline isn't the company's (or isn't a uuid). Throws on a database error.
 */
export async function resolvePipelineId(
  { supabase, company }: Ctx,
  { pipelineId, jobPostId }: StageScope = {},
): Promise<string | null> {
  if (jobPostId !== undefined) {
    if (typeof jobPostId !== "string" || !isUuid(jobPostId)) return null;
    const { data, error } = await supabase
      .from("job_postings")
      .select("pipeline_id")
      .eq("id", jobPostId)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw new Error(`Failed to load the job's pipeline: ${error.message}`);
    return data?.pipeline_id ?? null;
  }

  if (pipelineId !== undefined && (typeof pipelineId !== "string" || !isUuid(pipelineId))) return null;
  let query = supabase.from("company_pipelines").select("id").eq("company_id", company.id);
  if (pipelineId !== undefined) {
    query = query.eq("id", pipelineId);
  } else {
    query = query.eq("is_default", true);
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Failed to load the pipeline: ${error.message}`);
  return data?.id ?? null;
}

/**
 * One pipeline's stages (see `StageScope`), ordered by position. Archived
 * stages only with `includeArchived`. An unknown job or pipeline has none.
 * Throws on a database error.
 */
export async function listStages(
  ctx: Ctx,
  { includeArchived = false, ...scope }: StageScope & { includeArchived?: boolean } = {},
): Promise<PipelineStage[]> {
  const pipelineId = await resolvePipelineId(ctx, scope);
  if (!pipelineId) return [];
  return listPipelineStages(ctx, pipelineId, { includeArchived });
}

/**
 * The stages of a pipeline id the caller already read from the company's own
 * rows (e.g. its job's `pipeline_id`), still filtered by the company.
 */
export async function listPipelineStages(
  { supabase, company }: Ctx,
  pipelineId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<PipelineStage[]> {
  let query = supabase
    .from("pipeline_stages")
    .select("*")
    .eq("company_id", company.id)
    .eq("pipeline_id", pipelineId);
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query.order("position", { ascending: true });
  if (error) throw new Error(`Failed to load the pipeline stages: ${error.message}`);
  return data ?? [];
}

/**
 * A job's active stages for the session user, cached for the request (pages
 * and their layout share one load). `[]` for a job that isn't the company's.
 */
export const stagesForJob = cache(
  async (companyId: string, jobPostId: string, includeArchived = false): Promise<PipelineStage[]> => {
    const supabase = await createClient();
    return listStages({ supabase, company: { id: companyId } }, { jobPostId, includeArchived });
  },
);

/** Adds a stage after every existing one of its pipeline (archived included, positions are unique). */
export async function createStage(
  ctx: Ctx,
  { name, kind, pipelineId }: { name: string; kind: PipelineStageKind; pipelineId?: string },
): Promise<{ ok: true; stage: PipelineStage } | { ok: false; error: string }> {
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: NAME_ERROR };
  if (!KINDS.has(kind)) return { ok: false, error: "Invalid stage kind." };

  let pipeline: string | null;
  try {
    pipeline = await resolvePipelineId(ctx, { pipelineId });
  } catch {
    return { ok: false, error: "Failed to load the pipeline." };
  }
  if (!pipeline) return { ok: false, error: PIPELINE_NOT_FOUND };

  const { data: existing, error: loadError } = await ctx.supabase
    .from("pipeline_stages")
    .select("id, position, archived")
    .eq("company_id", ctx.company.id)
    .eq("pipeline_id", pipeline);
  if (loadError) return { ok: false, error: "Failed to load the pipeline stages." };

  const stages = existing ?? [];
  if (stages.filter((s) => !s.archived).length >= MAX_ACTIVE_STAGES) {
    return { ok: false, error: `A pipeline can have at most ${MAX_ACTIVE_STAGES} stages.` };
  }
  const position = stages.reduce((max, s) => Math.max(max, s.position), -1) + 1;

  const { data: stage, error } = await ctx.supabase
    .from("pipeline_stages")
    .insert({ company_id: ctx.company.id, pipeline_id: pipeline, name: clean, kind, position })
    .select("*")
    .single();
  if (error || !stage) return { ok: false, error: "Failed to add the stage." };
  return { ok: true, stage };
}

/** Renames a stage the user picked, checked against the company (and the pipeline, when given). */
export async function renameStage(
  { supabase, company }: Ctx,
  { stageId, name, pipelineId }: { stageId: string; name: string; pipelineId?: string },
): Promise<Result> {
  if (typeof stageId !== "string" || !isUuid(stageId)) return NOT_FOUND;
  if (pipelineId !== undefined && (typeof pipelineId !== "string" || !isUuid(pipelineId))) return NOT_FOUND;
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: NAME_ERROR };

  let query = supabase
    .from("pipeline_stages")
    .update({ name: clean })
    .eq("id", stageId)
    .eq("company_id", company.id);
  if (pipelineId) query = query.eq("pipeline_id", pipelineId);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) return { ok: false, error: "Failed to rename the stage." };
  if (!data) return NOT_FOUND;
  return { ok: true };
}

/**
 * Archives an empty stage. The kinds applied, hired and rejected can't be
 * archived (the DB guard refuses the last of each in a pipeline too).
 */
export async function archiveStage(
  { supabase, company }: Ctx,
  { stageId, pipelineId }: { stageId: string; pipelineId?: string },
): Promise<Result | { ok: false; error: string; count: number }> {
  if (typeof stageId !== "string" || !isUuid(stageId)) return NOT_FOUND;
  if (pipelineId !== undefined && (typeof pipelineId !== "string" || !isUuid(pipelineId))) return NOT_FOUND;

  let load = supabase
    .from("pipeline_stages")
    .select("id, kind, archived")
    .eq("id", stageId)
    .eq("company_id", company.id);
  if (pipelineId) load = load.eq("pipeline_id", pipelineId);
  const { data: stage, error: loadError } = await load.maybeSingle();
  if (loadError) return { ok: false, error: "Failed to load the stage." };
  if (!stage) return NOT_FOUND;
  if (PROTECTED_KINDS.has(stage.kind)) {
    return { ok: false, error: "The Applied, Hired and Rejected stages can't be archived." };
  }
  if (stage.archived) return { ok: true };

  const { count, error: countError } = await supabase
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stageId);
  if (countError) return { ok: false, error: "Failed to check the stage's applications." };
  if (count && count > 0) {
    return {
      ok: false,
      error: `Move the ${count} application${count === 1 ? "" : "s"} out of this stage first.`,
      count,
    };
  }

  const { error } = await supabase
    .from("pipeline_stages")
    .update({ archived: true })
    .eq("id", stageId)
    .eq("company_id", company.id);
  if (error) return { ok: false, error: "Failed to archive the stage." };
  return { ok: true };
}

/** `ids` must be exactly one pipeline's active stages (the default's unless `pipelineId`), in their new order. */
export async function reorderStages(
  ctx: Ctx,
  ids: string[],
  { pipelineId }: { pipelineId?: string } = {},
): Promise<Result> {
  const invalid = { ok: false, error: "Reorder every active stage exactly once." } as const;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !isUuid(id))) {
    return invalid;
  }
  if (new Set(ids).size !== ids.length) return invalid;

  let pipeline: string | null;
  try {
    pipeline = await resolvePipelineId(ctx, { pipelineId });
  } catch {
    return { ok: false, error: "Failed to load the pipeline." };
  }
  if (!pipeline) return { ok: false, error: PIPELINE_NOT_FOUND };

  const { data: active, error: loadError } = await ctx.supabase
    .from("pipeline_stages")
    .select("id")
    .eq("company_id", ctx.company.id)
    .eq("pipeline_id", pipeline)
    .eq("archived", false);
  if (loadError) return { ok: false, error: "Failed to load the pipeline stages." };

  const activeIds = new Set((active ?? []).map((s) => s.id));
  if (activeIds.size !== ids.length || ids.some((id) => !activeIds.has(id))) return invalid;

  const { error } = await ctx.supabase.rpc("reorder_pipeline_stages", { p_ids: ids });
  if (error) return { ok: false, error: "Failed to reorder the stages." };
  return { ok: true };
}
