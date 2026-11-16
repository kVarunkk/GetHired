"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  previewAgentJobPipelineSwitch,
  type AgentPipelineSwitchPreview,
} from "@/helpers/pipeline/preview-agent-pipeline";

const jobOf = z.object({ jobPostId: z.string().uuid() });

/**
 * SERVER ACTION (JPT-041): the agent's approval card for a proposed
 * `setJobPipeline` call. Needs jobs.edit on the job, the same as the switch.
 * The work is `previewAgentJobPipelineSwitch`, which MCP shares. Reads only.
 */
export async function previewAgentJobPipelineSwitchAction(input: unknown): Promise<AgentPipelineSwitchPreview> {
  const job = jobOf.safeParse(input);
  if (!job.success) return { ok: false, error: "Couldn't read the proposed switch." };
  const auth = await requireCompanyForAction({ permission: "jobs.edit", jobId: job.data.jobPostId });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentJobPipelineSwitch(auth, input);
}
