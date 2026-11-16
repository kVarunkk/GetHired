"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { setDefaultPipeline } from "@/helpers/pipeline/pipelines";

const inputSchema = z.object({ pipelineId: z.string().uuid() }).strict();

/** SERVER ACTION (JPT-031): the pipeline new jobs get. Existing jobs keep theirs. */
export async function setDefaultPipelineAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "settings.stages" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't change the default pipeline." };

  const result = await setDefaultPipeline(auth, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/company/settings", "layout");
  return { ok: true };
}
