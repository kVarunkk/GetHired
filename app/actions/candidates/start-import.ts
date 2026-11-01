"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { importMessage } from "@/helpers/candidates/copy";

const inputSchema = z.object({ fileName: z.string().trim().min(1).max(255) }).strict();

export type StartImportResult = { ok: true; batchId: string } | { ok: false; error: string };

/**
 * SERVER ACTION (BI-REQ-010): opens a draft spreadsheet batch for a file the
 * browser has read. `start_candidate_import` applies BI-SEC-008's limits (5
 * imports an hour, 20 a day per company). The destination is checked on
 * confirm, so any scope of applicants.import will do here.
 */
export async function startImportAction(input: z.input<typeof inputSchema>): Promise<StartImportResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importMessage("invalid") };

  const { data, error } = await auth.supabase.rpc("start_candidate_import", {
    p_kind: "spreadsheet",
    p_file_name: parsed.data.fileName,
  });
  if (error) throw new Error(`Failed to start the import: ${error.message}`);
  const result = data as { ok: boolean; reason?: string; batch_id?: string };
  if (!result.ok || !result.batch_id) return { ok: false, error: importMessage(result.reason) };
  return { ok: true, batchId: result.batch_id };
}
