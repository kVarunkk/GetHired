"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { updateCandidate, type UpdateCandidateResult } from "@/helpers/candidates/candidate-writes";
import { IMPORT_MESSAGES } from "@/helpers/candidates/copy";

const inputSchema = z.object({ candidateId: z.string().uuid(), fields: z.record(z.unknown()) }).strict();


/**
 * SERVER ACTION (BI-REQ-004): edits a company candidate's fields with the
 * import's schema (`updateCandidate`). `update_company_candidate` checks
 * applicants.import (unscoped, or for one of the candidate's jobs).
 */
export async function updateCandidateAction(input: z.input<typeof inputSchema>): Promise<UpdateCandidateResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: IMPORT_MESSAGES.invalid };
  return updateCandidate(auth, parsed.data.candidateId, parsed.data.fields);
}
