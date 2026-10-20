"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { inviteMember, inviteTemplateKeySchema } from "@/helpers/team/invites";
import type { CreateInviteResult } from "@/helpers/team/send-invite";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    /** Omitted: the company's default invite role (RP-REQ-004). */
    roleId: z.string().uuid().optional(),
    /** A template the company has no role for yet; the role is created first. */
    templateKey: inviteTemplateKeySchema.optional(),
  })
  .strict()
  .refine((input) => !(input.roleId && input.templateKey));

/**
 * SERVER ACTION (TM-REQ-002, RP-REQ-007): invites someone by email with one of
 * the company's roles. Needs team.invite; the RPC checks the role is the
 * company's and within the caller's ceiling (RP-REQ-012 rule 3). Inviting with
 * a template also needs roles.manage (`inviteMember`).
 */
export async function inviteMemberAction(input: z.input<typeof inputSchema>): Promise<CreateInviteResult> {
  const auth = await requireCompanyForAction({ permission: "team.invite" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid email and choose a role." };

  const result = await inviteMember(auth, parsed.data);
  if (!result.ok) return result;

  revalidatePath("/company/settings/team");
  await eventCaptureServer({ event: PostHogEvent.TeamMemberInvited, distinctId: auth.user.id });
  return result;
}
