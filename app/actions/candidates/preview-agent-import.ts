"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  previewAgentAddCandidate,
  previewAgentDeleteCandidates,
  previewAgentImport,
  type AddCandidatePreview,
  type DeleteCandidatesPreview,
  type DestinationPreview,
  type ImportPreview,
} from "@/helpers/candidates/preview-agent-import";

export type { AddCandidatePreview, DeleteCandidatesPreview, DestinationPreview, ImportPreview };

// SERVER ACTIONS (BI-REQ-060): the agent's approval cards for `confirmImport`,
// `addCandidate` and `deleteMyCandidates`. The work is in
// helpers/candidates/preview-agent-import.ts, which MCP shares. The company
// comes from the session.

export async function previewAgentImportAction(input: unknown): Promise<ImportPreview> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentImport(auth, input);
}

export async function previewAgentAddCandidateAction(input: unknown): Promise<AddCandidatePreview> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentAddCandidate(auth, input);
}

export async function previewAgentDeleteCandidatesAction(input: unknown): Promise<DeleteCandidatesPreview> {
  const auth = await requireCompanyForAction({ permission: "applicants.import", jobId: null });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentDeleteCandidates(auth, input);
}
