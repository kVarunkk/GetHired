"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  createCandidate,
  type CreateCandidateInput,
  type CreateCandidateResult,
} from "@/helpers/candidates/create-candidate";


/**
 * SERVER ACTION (BI-REQ-009, CP-REQ-001/003): adds one candidate by hand, to
 * the pool, a talent list and/or a job and stage (`createCandidate`). Nobody
 * is emailed.
 */
export async function createCandidateAction(input: CreateCandidateInput): Promise<CreateCandidateResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };
  return createCandidate(auth, input);
}
