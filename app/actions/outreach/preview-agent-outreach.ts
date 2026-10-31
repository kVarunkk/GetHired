"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  previewAgentOutreach,
  type PreviewAgentOutreachResult,
} from "@/helpers/outreach/preview-agent-outreach";

/**
 * SERVER ACTION (RAT-053): the agent's approval card for a proposed
 * `sendOutreach` (RA-REQ-005). The work is `previewAgentOutreach`, which MCP
 * shares. The company comes from the session.
 */
export async function previewAgentOutreachAction(input: unknown): Promise<PreviewAgentOutreachResult> {
  const auth = await requireCompanyForAction({ permission: "outreach.send" });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentOutreach(auth, input);
}
