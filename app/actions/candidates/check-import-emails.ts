"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { matchImportEmails } from "@/helpers/candidates/email-matches";
import { MAX_SHEET_ROWS } from "@/helpers/candidates/import-limits";
import type { EmailMatches } from "@/helpers/candidates/preview-rows";

const inputSchema = z.object({ emails: z.array(z.string().max(254)).max(MAX_SHEET_ROWS) }).strict();

export type CheckImportEmailsResult = ({ ok: true } & EmailMatches) | { ok: false; error: string };

/**
 * SERVER ACTION (BI-REQ-014/019): which of a spreadsheet's emails are already
 * the company's candidates, and which belong to GetHired users the member can
 * already see (`matchImportEmails`).
 */
export async function checkImportEmailsAction(input: z.input<typeof inputSchema>): Promise<CheckImportEmailsResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Check at most ${MAX_SHEET_ROWS.toLocaleString("en-US")} emails.` };
  return { ok: true, ...(await matchImportEmails(auth.supabase, auth.company.id, parsed.data.emails)) };
}
