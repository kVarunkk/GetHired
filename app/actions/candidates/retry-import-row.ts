"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { importMessage } from "@/helpers/candidates/copy";
import { retryImportRow, type RetryImportRowResult } from "@/helpers/candidates/import-row-writes";

const inputSchema = z.object({ rowId: z.string().uuid() }).strict();


/**
 * SERVER ACTION (BI-REQ-023): queues a failed file again, holding a new
 * resume_imports unit for the session user (`retryImportRow`).
 * `retry_import_row` checks applicants.import for the batch's job.
 */
export async function retryImportRowAction(input: z.input<typeof inputSchema>): Promise<RetryImportRowResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importMessage("invalid") };
  return retryImportRow(auth, parsed.data.rowId);
}
