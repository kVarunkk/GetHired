"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { asTeamRpcResult, teamErrorMessage } from "@/helpers/team/errors";

const inputSchema = z.object({ inviteId: z.string().uuid() }).strict();

/** SERVER ACTION (TM-REQ-002): revokes an open invite of the caller's company (team.invite). */
export async function revokeInviteAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "team.invite" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: teamErrorMessage("not_found") };

  // The RPC scopes the invite to the caller's company.
  const { data, error } = await auth.supabase.rpc("revoke_company_invite", {
    p_invite_id: parsed.data.inviteId,
  });
  if (error) return { ok: false, error: teamErrorMessage("unknown") };
  const result = asTeamRpcResult(data);
  if (!result.ok) return { ok: false, error: teamErrorMessage(result.reason) };

  revalidatePath("/company/settings/team");
  return { ok: true };
}
