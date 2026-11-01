"use server";

import type { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  previewAgentRole,
  rolePreviewPermission,
  type PreviewAgentRoleResult,
  type rolePreviewInput,
} from "@/helpers/companies/preview-agent-role";

/**
 * SERVER ACTION: the approval card's preview for the agent's role tools
 * (RP-REQ-032). The work is `previewAgentRole`, which MCP shares. The company
 * comes from the session.
 */
export async function previewAgentRoleAction(input: z.input<typeof rolePreviewInput>): Promise<PreviewAgentRoleResult> {
  const auth = await requireCompanyForAction({ permission: rolePreviewPermission(input) });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentRole(auth, input);
}
