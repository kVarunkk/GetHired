"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { asTeamRpcResult, teamErrorMessage } from "@/helpers/team/errors";

const inputSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();

/**
 * SERVER ACTION (TM-REQ-008): the session member's own display name, shown on
 * their notes, moves and outreach from now on (earlier ones keep the name
 * stored when they were written).
 */
export async function updateDisplayNameAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: teamErrorMessage("invalid_name") };

  const { data, error } = await auth.supabase.rpc("set_my_display_name", { p_name: parsed.data.name });
  if (error) return { ok: false, error: teamErrorMessage("unknown") };
  const result = asTeamRpcResult(data);
  if (!result.ok) return { ok: false, error: teamErrorMessage(result.reason) };

  revalidatePath("/company/settings/team");
  return { ok: true };
}
