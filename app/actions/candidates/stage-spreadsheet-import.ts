"use server";

import type { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { IMPORT_MESSAGES } from "@/helpers/candidates/copy";
import { MAX_SHEET_ROWS } from "@/helpers/candidates/import-limits";
import {
  stageSpreadsheet,
  stageSpreadsheetSchema,
  type StageSpreadsheetResult,
} from "@/helpers/candidates/staged-import";

export type StageSpreadsheetImportInput = z.input<typeof stageSpreadsheetSchema>;

/**
 * SERVER ACTION (BI-REQ-060): the recruiter agent's spreadsheet widget sends
 * a file's mapped rows here after the member checked the column mapping, so
 * the agent can review and confirm them (`stageSpreadsheet`). Needs
 * applicants.import for the job, or unscoped without one. Nothing is
 * imported until Confirm.
 */
export async function stageSpreadsheetImportAction(input: StageSpreadsheetImportInput): Promise<StageSpreadsheetResult> {
  const parsed = stageSpreadsheetSchema.safeParse(input);
  // An unparseable request needs scope `all`, so it's still refused for scoped members.
  const auth = await requireCompanyForAction({
    permission: "applicants.import",
    jobId: parsed.success ? (parsed.data.jobPostId ?? null) : null,
  });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!parsed.success) {
    const tooMany = Array.isArray(input?.rows) && input.rows.length > MAX_SHEET_ROWS;
    return {
      ok: false,
      error: tooMany ? `Import at most ${MAX_SHEET_ROWS.toLocaleString("en-US")} rows at a time.` : IMPORT_MESSAGES.invalid,
    };
  }
  return stageSpreadsheet(auth, parsed.data);
}
