"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { asTeamRpcResult, teamErrorMessage } from "@/helpers/team/errors";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z.object({ userId: z.string().uuid(), roleId: z.string().uuid() }).strict();

/**
 * SERVER ACTION (RP-REQ-007): changes a member's role. Needs
 * team.assign_roles; the RPC resolves both the member and the role within the
 * caller's company and enforces RP-REQ-012 (not above yourself, not your own
 * role, not an owner).
 */
export async function changeRoleAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "team.assign_roles" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: teamErrorMessage("invalid_role") };

  const { data, error } = await auth.supabase.rpc("set_company_member_role", {
    p_user_id: parsed.data.userId,
    p_role_id: parsed.data.roleId,
  });
  if (error) return { ok: false, error: teamErrorMessage("unknown") };
  const result = asTeamRpcResult(data);
  if (!result.ok) return { ok: false, error: teamErrorMessage(result.reason) };

  revalidatePath("/company/settings/team");
  revalidatePath("/company/settings/roles");
  await eventCaptureServer({ event: PostHogEvent.TeamRoleChanged, distinctId: auth.user.id });
  return { ok: true };
}
