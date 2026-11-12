"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { importMessage } from "@/helpers/candidates/copy";
import { discardResumeImport, type DiscardResumeImportResult } from "@/helpers/candidates/import-row-writes";

const inputSchema = z.object({ batchId: z.string().uuid() }).strict();

/**
 * SERVER ACTION: throws away an unconfirmed resume import so the page shows
 * the upload again (`discardResumeImport`). `discard_resume_import` checks
 * applicants.import for the batch's job.
 */
export async function discardResumeImportAction(
  input: z.input<typeof inputSchema>,
): Promise<DiscardResumeImportResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importMessage("invalid") };
  return discardResumeImport(auth, parsed.data.batchId);
}
