"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { createPipeline } from "@/helpers/pipeline/pipelines";

const inputSchema = z
  .object({ name: z.string().max(200), fromPipelineId: z.string().uuid().optional() })
  .strict();

export type CreatePipelineActionResult = { ok: true; pipelineId: string } | { ok: false; error: string };

/** SERVER ACTION (JPT-031): a new pipeline, copied from another (the default when omitted). */
export async function createPipelineAction(
  input: z.input<typeof inputSchema>,
): Promise<CreatePipelineActionResult> {
  const auth = await requireCompanyForAction({ permission: "settings.stages" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't create that pipeline." };

  const result = await createPipeline(auth, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/company/settings", "layout");
  return result;
}
