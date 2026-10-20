"use server";

import { applicantRpcResult, requireApplicant, type ApplicantActionResult } from "@/helpers/interview/screening/applicant-rpc";
import { SCREENING_CONSENT_VERSION } from "@/helpers/interview/screening/schemas";

/**
 * SERVER ACTION: the applicant agrees to the interview terms (SI-REQ-020).
 * Stores the current consent version; only while the interview is invited.
 */
export async function recordScreeningConsentAction({ id }: { id: string }): Promise<ApplicantActionResult> {
  const auth = await requireApplicant();
  if (!auth.ok) return auth;
  const { data, error } = await auth.supabase.rpc("record_screening_consent", {
    p_id: id,
    p_version: SCREENING_CONSENT_VERSION,
  });
  return applicantRpcResult(data, error);
}
