"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  previewAgentCustomizeJobPipeline,
  type AgentCustomizePipelinePreview,
} from "@/helpers/pipeline/preview-agent-pipeline";

/**
 * SERVER ACTION (JPT-041): the agent's approval card for a proposed
 * `customizeJobPipeline` call. Needs settings.stages, the same as
 * forkJobPipelineAction. Reads only.
 */
export async function previewAgentCustomizeJobPipelineAction(input: unknown): Promise<AgentCustomizePipelinePreview> {
  const auth = await requireCompanyForAction({ permission: "settings.stages" });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentCustomizeJobPipeline(auth, input);
}
