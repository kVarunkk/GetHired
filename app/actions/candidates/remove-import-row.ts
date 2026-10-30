"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { importMessage } from "@/helpers/candidates/copy";
import { removeImportRow, type RemoveImportRowResult } from "@/helpers/candidates/import-row-writes";

const inputSchema = z.object({ rowId: z.string().uuid() }).strict();


/**
 * SERVER ACTION (BI-REQ-023): takes a file out of a resume batch
 * (`removeImportRow`). `remove_import_row` checks applicants.import for the
 * batch's job.
 */
export async function removeImportRowAction(input: z.input<typeof inputSchema>): Promise<RemoveImportRowResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importMessage("invalid") };
  return removeImportRow(auth, parsed.data.rowId);
}
