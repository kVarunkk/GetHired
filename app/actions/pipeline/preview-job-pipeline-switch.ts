"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { previewJobPipelineSwitch, type JobPipelineSwitchPreview } from "@/helpers/pipeline/pipelines";

const inputSchema = z.object({ jobPostId: z.string().uuid(), pipelineId: z.string().uuid() }).strict();

export type PreviewJobPipelineSwitchActionResult = JobPipelineSwitchPreview | { ok: false; error: string };

/**
 * SERVER ACTION (JPT-036, JP-REQ-006): the mapping table for moving a job to
 * another pipeline (the switch page). Reads only. Needs jobs.edit on the job,
 * the same as the switch itself.
 */
export async function previewJobPipelineSwitchAction(
  input: z.input<typeof inputSchema>,
): Promise<PreviewJobPipelineSwitchActionResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't load the pipeline." };

  const auth = await requireCompanyForAction({ permission: "jobs.edit", jobId: parsed.data.jobPostId });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await previewJobPipelineSwitch(auth, parsed.data);
  return result.ok ? result : { ok: false, error: result.error };
}
