"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { asTeamRpcResult, teamErrorMessage } from "@/helpers/team/errors";
import { createAndSendInvite, type CreateInviteResult } from "@/helpers/team/send-invite";

const inputSchema = z.object({ inviteId: z.string().uuid() }).strict();

/**
 * SERVER ACTION (TM-REQ-002): resends an open invite with a new token. The old
 * invite is revoked first (its token stops working), then a new one is created
 * for the same email and role (the default role if that role was deleted).
 * Tokens are never stored, so there's nothing to send again.
 */
export async function resendInviteAction(input: z.input<typeof inputSchema>): Promise<CreateInviteResult> {
  const auth = await requireCompanyForAction({ permission: "team.invite" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: teamErrorMessage("not_found") };

  const { data: invite, error: loadError } = await auth.supabase
    .from("company_invites")
    .select("id, email, role_id")
    .eq("id", parsed.data.inviteId)
    .eq("company_id", auth.company.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();
  if (loadError) return { ok: false, error: teamErrorMessage("unknown") };
  if (!invite) return { ok: false, error: teamErrorMessage("not_found") };

  const { data, error } = await auth.supabase.rpc("revoke_company_invite", { p_invite_id: invite.id });
  if (error) return { ok: false, error: teamErrorMessage("unknown") };
  const revoked = asTeamRpcResult(data);
  if (!revoked.ok) return { ok: false, error: teamErrorMessage(revoked.reason) };

  const result = await createAndSendInvite(auth, { email: invite.email, roleId: invite.role_id });
  revalidatePath("/company/settings/team");
  return result;
}
