"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  MAX_ACTIVE_STAGES,
  archiveStage,
  createStage,
  renameStage,
  reorderStages,
  type PipelineStage,
} from "@/helpers/pipeline/stages";
import { Constants } from "@/utils/types/database.types";

const name = z.string().max(200);
/** The pipeline being edited (the default when omitted, as the agent's tools still do). */
const pipelineId = z.string().uuid().optional();
const inputSchema = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("create"), name, kind: z.enum(Constants.public.Enums.pipeline_stage_kind), pipelineId })
    .strict(),
  z.object({ op: z.literal("rename"), stageId: z.string().uuid(), name, pipelineId }).strict(),
  z.object({ op: z.literal("archive"), stageId: z.string().uuid(), pipelineId }).strict(),
  z
    .object({ op: z.literal("reorder"), ids: z.array(z.string().uuid()).min(1).max(MAX_ACTIVE_STAGES), pipelineId })
    .strict(),
]);

export type SaveStagesActionResult =
  | { ok: true; stage?: PipelineStage }
  | { ok: false; error: string; count?: number };

/**
 * SERVER ACTION (PL-TASK-032): one change to one of the session company's
 * pipelines (add, rename, archive or reorder a stage). The helpers check the
 * pipeline is the company's (JPT-033). The rules are in `helpers/pipeline/stages.ts`.
 */
export async function saveStagesAction(input: z.input<typeof inputSchema>): Promise<SaveStagesActionResult> {
  const auth = await requireCompanyForAction({ permission: "settings.stages" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't save that change." };
  const change = parsed.data;

  const result =
    change.op === "create"
      ? await createStage(auth, { name: change.name, kind: change.kind, pipelineId: change.pipelineId })
      : change.op === "rename"
        ? await renameStage(auth, { stageId: change.stageId, name: change.name, pipelineId: change.pipelineId })
        : change.op === "archive"
          ? await archiveStage(auth, { stageId: change.stageId, pipelineId: change.pipelineId })
          : await reorderStages(auth, change.ids, { pipelineId: change.pipelineId });

  // The list's stage counts and the editor pages.
  if (result.ok) revalidatePath("/company/settings", "layout");
  return result;
}
