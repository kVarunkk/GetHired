"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  deleteCandidates,
  MAX_DELETE_CANDIDATES,
  type DeleteCandidatesResult,
} from "@/helpers/candidates/candidate-writes";

const inputSchema = z
  .object({ candidateIds: z.array(z.string().uuid()).min(1).max(MAX_DELETE_CANDIDATES) })
  .strict();

/**
 * SERVER ACTION (BI-REQ-007): deletes company candidates with their imported
 * applications, list memberships and resume files (`deleteCandidates`).
 * Needs applicants.import for every job (unscoped), since a candidate can be
 * in jobs the member isn't on.
 */
export async function deleteCandidatesAction(input: z.input<typeof inputSchema>): Promise<DeleteCandidatesResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import", jobId: null });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Choose 1 to ${MAX_DELETE_CANDIDATES} candidates.` };
  return deleteCandidates(auth, parsed.data.candidateIds);
}
