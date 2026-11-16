"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  isSchedulingPreviewTool,
  type SchedulingPreview,
} from "@/helpers/interviews/agent-scheduling-schema";
import { previewAgentScheduling } from "@/helpers/interviews/preview-agent-scheduling";

/**
 * SERVER ACTION (IVT-082): the approval card for a proposed scheduling call
 * by the recruiter agent. The work is `previewAgentScheduling`, which MCP
 * shares and which checks the tool's own permission for the job. The
 * company comes from the session.
 */
export async function previewAgentSchedulingAction(tool: string, input: unknown): Promise<SchedulingPreview> {
  if (!isSchedulingPreviewTool(tool)) return { ok: false, error: "Couldn't read this request." };
  const auth = await requireCompanyForAction({
    permission: tool === "saveInterviewPlan" ? "interview_plans.manage" : "scheduling.manage",
  });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentScheduling(auth, tool, input);
}
