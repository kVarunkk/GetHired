"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { previewAgentMove, type PreviewAgentMoveResult } from "@/helpers/pipeline/preview-agent-move";

/**
 * SERVER ACTION (RA-TASK-040): the agent's approval card for a proposed
 * `moveApplications` call. The work is `previewAgentMove`, which MCP shares.
 * The company comes from the session.
 */
export async function previewAgentMoveAction(input: unknown): Promise<PreviewAgentMoveResult> {
  const auth = await requireCompanyForAction({ permission: "pipeline.move" });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentMove(auth, input);
}
