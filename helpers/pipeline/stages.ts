import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import { Constants, type Database, type Tables } from "@/utils/types/database.types";
import type { PipelineStageKind } from "./status-map";

export type PipelineStage = Tables<"pipeline_stages">;

type Ctx = { supabase: SupabaseClient<Database>; company: MyCompany };
type Result = { ok: true } | { ok: false; error: string };

/** PL-REQ-001. */
export const MAX_ACTIVE_STAGES = 12;
export const MAX_STAGE_NAME = 40;
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
 * The session company's stages, ordered by position. Archived stages only
 * with `includeArchived`. Throws on a database error.
 */
export async function listStages(
  { supabase, company }: Ctx,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<PipelineStage[]> {
  let query = supabase.from("pipeline_stages").select("*").eq("company_id", company.id);
  if (!includeArchived) query = query.eq("archived", false);
  const { data, error } = await query.order("position", { ascending: true });
  if (error) throw new Error(`Failed to load the pipeline stages: ${error.message}`);
  return data ?? [];
}

/** Adds a stage after every existing one (archived included, positions are unique). */
export async function createStage(
  { supabase, company }: Ctx,
  { name, kind }: { name: string; kind: PipelineStageKind },
): Promise<{ ok: true; stage: PipelineStage } | { ok: false; error: string }> {
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: NAME_ERROR };
  if (!KINDS.has(kind)) return { ok: false, error: "Invalid stage kind." };

  const { data: existing, error: loadError } = await supabase
    .from("pipeline_stages")
    .select("id, position, archived")
    .eq("company_id", company.id);
  if (loadError) return { ok: false, error: "Failed to load the pipeline stages." };

  const stages = existing ?? [];
  if (stages.filter((s) => !s.archived).length >= MAX_ACTIVE_STAGES) {
    return { ok: false, error: `A pipeline can have at most ${MAX_ACTIVE_STAGES} stages.` };
  }
  const position = stages.reduce((max, s) => Math.max(max, s.position), -1) + 1;

  const { data: stage, error } = await supabase
    .from("pipeline_stages")
    .insert({ company_id: company.id, name: clean, kind, position })
    .select("*")
    .single();
  if (error || !stage) return { ok: false, error: "Failed to add the stage." };
  return { ok: true, stage };
}

export async function renameStage(
  { supabase, company }: Ctx,
  { stageId, name }: { stageId: string; name: string },
): Promise<Result> {
  if (typeof stageId !== "string" || !isUuid(stageId)) return NOT_FOUND;
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: NAME_ERROR };

  const { data, error } = await supabase
    .from("pipeline_stages")
    .update({ name: clean })
    .eq("id", stageId)
    .eq("company_id", company.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "Failed to rename the stage." };
  if (!data) return NOT_FOUND;
  return { ok: true };
}

/**
 * Archives an empty stage. The kinds applied, hired and rejected can't be
 * archived (the DB guard refuses it too).
 */
export async function archiveStage(
  { supabase, company }: Ctx,
  { stageId }: { stageId: string },
): Promise<Result | { ok: false; error: string; count: number }> {
  if (typeof stageId !== "string" || !isUuid(stageId)) return NOT_FOUND;

  const { data: stage, error: loadError } = await supabase
    .from("pipeline_stages")
    .select("id, kind, archived")
    .eq("id", stageId)
    .eq("company_id", company.id)
    .maybeSingle();
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

/** `ids` must be exactly the company's active stages, in their new order. */
export async function reorderStages({ supabase, company }: Ctx, ids: string[]): Promise<Result> {
  const invalid = { ok: false, error: "Reorder every active stage exactly once." } as const;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !isUuid(id))) {
    return invalid;
  }
  if (new Set(ids).size !== ids.length) return invalid;

  const { data: active, error: loadError } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("company_id", company.id)
    .eq("archived", false);
  if (loadError) return { ok: false, error: "Failed to load the pipeline stages." };

  const activeIds = new Set((active ?? []).map((s) => s.id));
  if (activeIds.size !== ids.length || ids.some((id) => !activeIds.has(id))) return invalid;

  const { error } = await supabase.rpc("reorder_pipeline_stages", { p_ids: ids });
  if (error) return { ok: false, error: "Failed to reorder the stages." };
  return { ok: true };
}
