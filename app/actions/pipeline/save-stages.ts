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
const inputSchema = z.discriminatedUnion("op", [
  z
    .object({ op: z.literal("create"), name, kind: z.enum(Constants.public.Enums.pipeline_stage_kind) })
    .strict(),
  z.object({ op: z.literal("rename"), stageId: z.string().uuid(), name }).strict(),
  z.object({ op: z.literal("archive"), stageId: z.string().uuid() }).strict(),
  z.object({ op: z.literal("reorder"), ids: z.array(z.string().uuid()).min(1).max(MAX_ACTIVE_STAGES) }).strict(),
]);

export type SaveStagesActionResult =
  | { ok: true; stage?: PipelineStage }
  | { ok: false; error: string; count?: number };

/**
 * SERVER ACTION (PL-TASK-032): one change to the session company's stages
 * (add, rename, archive or reorder). The rules are in `helpers/pipeline/stages.ts`.
 */
export async function saveStagesAction(input: z.input<typeof inputSchema>): Promise<SaveStagesActionResult> {
  const auth = await requireCompanyForAction({ permission: "settings.stages" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't save that change." };
  const change = parsed.data;

  const result =
    change.op === "create"
      ? await createStage(auth, { name: change.name, kind: change.kind })
      : change.op === "rename"
        ? await renameStage(auth, { stageId: change.stageId, name: change.name })
        : change.op === "archive"
          ? await archiveStage(auth, { stageId: change.stageId })
          : await reorderStages(auth, change.ids);

  if (result.ok) revalidatePath("/company/settings");
  return result;
}
