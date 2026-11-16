"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { jobPipelinePath } from "@/helpers/jobs/paths";
import { setJobPipeline } from "@/helpers/pipeline/pipelines";
import type { RefusedStage } from "@/helpers/pipeline/copy";
import type { ApplicationStatus } from "@/helpers/pipeline/status-map";

const inputSchema = z
  .object({
    jobPostId: z.string().uuid(),
    pipelineId: z.string().uuid(),
    mapping: z.record(z.string().uuid(), z.string().uuid()).optional(),
  })
  .strict();

export type SetJobPipelineActionResult = {
  ok: false;
  error: string;
  stage?: RefusedStage | null;
  status?: ApplicationStatus | null;
};

/**
 * SERVER ACTION (JPT-031, JP-REQ-006): moves a job and its applications to
 * another pipeline. Never changes a candidate's status and never emails.
 *
 * Returns only refusals. On success it redirects to the job's Pipeline
 * section, so the client gets `undefined`. The redirect has to happen here: a
 * client `router.push` after an action that revalidated the job's layout
 * races the action's own RSC stream ("chunk.reason.enqueueModel is not a
 * function" in dev).
 */
export async function setJobPipelineAction(
  input: z.input<typeof inputSchema>,
): Promise<SetJobPipelineActionResult | undefined> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't switch the job's pipeline." };
  const { jobPostId } = parsed.data;

  const auth = await requireCompanyForAction({ permission: "jobs.edit", jobId: jobPostId });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await setJobPipeline(auth, parsed.data);
  if (!result.ok) {
    return { ok: false, error: result.error, stage: result.stage, status: result.status };
  }
  if (result.changed) {
    revalidatePath(`/company/job-posts/${jobPostId}`, "layout");
    revalidatePath("/company/settings", "layout");
  }
  redirect(jobPipelinePath(jobPostId));
}
