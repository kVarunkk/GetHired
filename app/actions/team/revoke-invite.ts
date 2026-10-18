"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { teamErrorMessage } from "@/helpers/team/errors";
import { revokeInvite } from "@/helpers/team/invites";

const inputSchema = z.object({ inviteId: z.string().uuid() }).strict();

/** SERVER ACTION (TM-REQ-002): revokes an open invite of the caller's company (team.invite). */
export async function revokeInviteAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "team.invite" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: teamErrorMessage("not_found") };

  const result = await revokeInvite(auth.supabase, parsed.data.inviteId);
  if (!result.ok) return result;

  revalidatePath("/company/settings/team");
  return { ok: true };
}
