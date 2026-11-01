"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { importMessage } from "@/helpers/candidates/copy";
import { updateImportRow, type UpdateImportRowResult } from "@/helpers/candidates/import-row-writes";

const inputSchema = z
  .object({
    rowId: z.string().uuid(),
    fields: z.record(z.unknown()).optional(),
    duplicateAction: z.enum(["skip", "fill", "overwrite"]).optional(),
  })
  .strict();


/**
 * SERVER ACTION (BI-REQ-023/024): a member's edit to a parsed resume row in
 * the review grid and its duplicate action (`updateImportRow`).
 * `update_import_row` checks applicants.import for the batch's job.
 */
export async function updateImportRowAction(input: z.input<typeof inputSchema>): Promise<UpdateImportRowResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importMessage("invalid") };
  return updateImportRow(auth, parsed.data);
}
