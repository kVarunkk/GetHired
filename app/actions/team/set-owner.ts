"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { asTeamRpcResult, teamErrorMessage } from "@/helpers/team/errors";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z.discriminatedUnion("isOwner", [
  z.object({ userId: z.string().uuid(), isOwner: z.literal(true) }).strict(),
  // A demoted owner gets a role in the same step (RP-REQ-006).
  z.object({ userId: z.string().uuid(), isOwner: z.literal(false), roleId: z.string().uuid() }).strict(),
]);

/**
 * SERVER ACTION (RP-REQ-006): owners make a member an owner, or remove a
 * co-owner's owner status and give them a role. The primary owner can't be
 * demoted, and a company always keeps an owner (both in SQL).
 */
export async function setOwnerAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ owner: true });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: teamErrorMessage("invalid_role") };

  const { data, error } = await auth.supabase.rpc("set_company_owner", {
    p_user_id: parsed.data.userId,
    p_is_owner: parsed.data.isOwner,
    ...(parsed.data.isOwner ? {} : { p_role_id: parsed.data.roleId }),
  });
  if (error) return { ok: false, error: teamErrorMessage("unknown") };
  const result = asTeamRpcResult(data);
  if (!result.ok) return { ok: false, error: teamErrorMessage(result.reason) };

  revalidatePath("/company", "layout");
  await eventCaptureServer({
    event: PostHogEvent.TeamOwnerChanged,
    distinctId: auth.user.id,
    properties: { is_owner: parsed.data.isOwner },
  });
  return { ok: true };
}
