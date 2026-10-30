"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  previewAgentInterviewInvite,
  type InvitePreviewApplicant,
  type PreviewAgentInterviewInviteResult,
} from "@/helpers/interview/screening/preview-agent-interview-invite";

export type { InvitePreviewApplicant, PreviewAgentInterviewInviteResult };

/**
 * SERVER ACTION (SIT-071): the agent's approval card for a proposed
 * `inviteToInterview` call. The work is `previewAgentInterviewInvite`, which
 * MCP shares. The company comes from the session.
 */
export async function previewAgentInterviewInviteAction(input: unknown): Promise<PreviewAgentInterviewInviteResult> {
  const auth = await requireCompanyForAction({ permission: "interviews.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentInterviewInvite(auth, input);
}
