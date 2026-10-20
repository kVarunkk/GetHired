"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { setDefaultRole } from "@/helpers/companies/role-rpc";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z.object({ roleId: z.string().uuid() }).strict();

/** SERVER ACTION (RP-REQ-004): sets the role new invites get. Needs roles.manage. */
export async function setDefaultRoleAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "roles.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a role." };

  const result = await setDefaultRole(auth.supabase, parsed.data.roleId);
  if (!result.ok) return { ok: false, error: result.error };

  await eventCaptureServer({ event: PostHogEvent.CompanyDefaultRoleChanged, distinctId: auth.user.id });
  return { ok: true };
}
