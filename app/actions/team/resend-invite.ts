"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { teamErrorMessage } from "@/helpers/team/errors";
import { resendInvite } from "@/helpers/team/invites";
import type { CreateInviteResult } from "@/helpers/team/send-invite";

const inputSchema = z.object({ inviteId: z.string().uuid() }).strict();

/** SERVER ACTION (TM-REQ-002): resends an open invite with a new token (`resendInvite`). */
export async function resendInviteAction(input: z.input<typeof inputSchema>): Promise<CreateInviteResult> {
  const auth = await requireCompanyForAction({ permission: "team.invite" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: teamErrorMessage("not_found") };

  const result = await resendInvite(auth, parsed.data.inviteId);
  revalidatePath("/company/settings/team");
  return result;
}
