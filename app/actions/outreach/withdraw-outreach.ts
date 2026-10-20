"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { withdrawOutreach } from "@/helpers/outreach/withdraw";

const inputSchema = z.object({ outreachId: z.string().uuid() }).strict();

export type WithdrawOutreachResult = { ok: true } | { ok: false; error: string };

/**
 * SERVER ACTION: withdraws one of the company's open outreach. The company
 * always comes from the session; the work is in `helpers/outreach/withdraw.ts`,
 * shared with the agent.
 */
export async function withdrawOutreachAction(
  input: z.input<typeof inputSchema>,
): Promise<WithdrawOutreachResult> {
  const auth = await requireCompanyForAction({ permission: "outreach.view" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Outreach not found." };

  const result = await withdrawOutreach(auth, parsed.data.outreachId, { source: "manual" });
  return result.ok ? { ok: true } : result;
}
