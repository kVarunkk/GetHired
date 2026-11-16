"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { pipelineEditorPath } from "@/helpers/pipeline/config";
import { forkJobPipeline } from "@/helpers/pipeline/pipelines";

const inputSchema = z.object({ jobPostId: z.string().uuid() }).strict();

export type ForkJobPipelineActionResult = { ok: false; error: string };

/**
 * SERVER ACTION (JPT-031, JP-REQ-007): "Customize for this job". Copies the
 * job's pipeline as "<job title>" and moves the job onto it stage for stage.
 *
 * Returns only refusals. On success it redirects to the new pipeline's editor
 * (the client gets `undefined`), for the reason in `setJobPipelineAction`.
 */
export async function forkJobPipelineAction(
  input: z.input<typeof inputSchema>,
): Promise<ForkJobPipelineActionResult | undefined> {
  const auth = await requireCompanyForAction({ permission: "settings.stages" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't customize the job's pipeline." };
  const { jobPostId } = parsed.data;

  const result = await forkJobPipeline(auth, { jobPostId });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/company/job-posts/${jobPostId}`, "layout");
  revalidatePath("/company/settings", "layout");
  redirect(pipelineEditorPath(result.pipelineId));
}
