"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { deleteRole } from "@/helpers/companies/role-rpc";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z
  .object({ roleId: z.string().uuid(), replacementRoleId: z.string().uuid().nullish() })
  .strict();

/**
 * SERVER ACTION (RP-REQ-008): deletes a role, moving its members and open
 * invites to the replacement in the same transaction. Needs roles.manage.
 */
export async function deleteRoleAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "roles.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a role." };

  const result = await deleteRole(auth.supabase, parsed.data.roleId, parsed.data.replacementRoleId ?? null);
  if (!result.ok) return { ok: false, error: result.error };

  await eventCaptureServer({
    event: PostHogEvent.CompanyRoleDeleted,
    distinctId: auth.user.id,
    properties: { moved: result.moved },
  });
  return { ok: true, moved: result.moved };
}
