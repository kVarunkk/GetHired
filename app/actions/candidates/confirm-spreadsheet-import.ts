"use server";

import type { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { IMPORT_MESSAGES } from "@/helpers/candidates/copy";
import {
  confirmSpreadsheetRows,
  confirmSpreadsheetSchema,
  type ConfirmSpreadsheetResult,
} from "@/helpers/candidates/confirm-spreadsheet";

export type ConfirmSpreadsheetImportInput = z.input<typeof confirmSpreadsheetSchema>;
export type ConfirmSpreadsheetImportResult = ConfirmSpreadsheetResult;

/**
 * SERVER ACTION (BI-REQ-015/016/017): confirms a spreadsheet batch with the
 * browser's rows (`confirmSpreadsheetRows`, which validates every row again).
 * Needs applicants.import for the job, or unscoped without one. Nobody is
 * emailed (BI-REQ-015c).
 */
export async function confirmSpreadsheetImportAction(
  input: ConfirmSpreadsheetImportInput,
): Promise<ConfirmSpreadsheetImportResult> {
  const parsed = confirmSpreadsheetSchema.safeParse(input);
  // An unparseable request needs scope `all`, so it's still refused for scoped members.
  const auth = await requireCompanyForAction({
    permission: "applicants.import",
    jobId: parsed.success ? (parsed.data.jobPostId ?? null) : null,
  });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!parsed.success) return { ok: false, error: IMPORT_MESSAGES.invalid };
  return confirmSpreadsheetRows(auth, parsed.data);
}
