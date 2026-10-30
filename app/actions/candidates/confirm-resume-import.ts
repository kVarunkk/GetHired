"use server";

import type { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { IMPORT_MESSAGES } from "@/helpers/candidates/copy";
import { confirmResumeBatch, confirmResumeSchema, type ConfirmResumeResult } from "@/helpers/candidates/confirm-resume";

export type ConfirmResumeImportInput = z.input<typeof confirmResumeSchema>;
export type ConfirmResumeImportResult = ConfirmResumeResult;

/**
 * SERVER ACTION (BI-REQ-025, CP-REQ-001–005): confirms a resume batch's
 * parsed rows into its destination (`confirmResumeBatch`). Any scope of
 * applicants.import gets past the first check; the destination is checked
 * there and again by `confirm_candidate_import`.
 */
export async function confirmResumeImportAction(input: ConfirmResumeImportInput): Promise<ConfirmResumeImportResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = confirmResumeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: IMPORT_MESSAGES.invalid };
  return confirmResumeBatch(auth, parsed.data);
}
