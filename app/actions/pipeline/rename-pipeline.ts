"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { renamePipeline } from "@/helpers/pipeline/pipelines";

const inputSchema = z.object({ pipelineId: z.string().uuid(), name: z.string().max(200) }).strict();

/** SERVER ACTION (JPT-031). */
export async function renamePipelineAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "settings.stages" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't rename that pipeline." };

  const result = await renamePipeline(auth, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };
  // The job pages name their pipeline.
  revalidatePath("/company/settings", "layout");
  revalidatePath("/company/job-posts", "layout");
  return { ok: true };
}
