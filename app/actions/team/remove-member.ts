"use server";

import { z } from "zod";
import { companyAllows, requireCompanyForAction } from "@/helpers/companies/require-company";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { teamErrorMessage } from "@/helpers/team/errors";
import { removeMember } from "@/helpers/team/remove-member";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z.object({ userId: z.string().uuid() }).strict();

/**
 * SERVER ACTION (TM-REQ-007, RP-REQ-006): removes a member, or lets anyone but
 * the primary owner leave (their own id). Removing someone else needs
 * team.remove; the RPC also refuses an owner (unless you're one), someone
 * above your role and the primary owner. Nothing is signed out: RLS stops the
 * removed member's access on their next request.
 */
export async function removeMemberAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true; left: boolean } | { ok: false; error: string }> {
  // Leaving needs only membership (allowlisted in test/require-company-usage.test.ts).
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: teamErrorMessage("not_found") };

  const left = parsed.data.userId === auth.user.id;
  if (!left) {
    const denied = companyAllows(auth.company, { permission: "team.remove" });
    if (denied) return { ok: false, error: denied };
  }

  const result = await removeMember(auth.supabase, parsed.data.userId);
  if (!result.ok) return result;

  await eventCaptureServer({
    event: PostHogEvent.TeamMemberRemoved,
    distinctId: auth.user.id,
    properties: { left },
  });
  return { ok: true, left };
}
