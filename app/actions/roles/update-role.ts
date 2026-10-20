"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { roleFieldsSchema } from "@/helpers/companies/role-input";
import { updateRole } from "@/helpers/companies/role-rpc";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

const inputSchema = roleFieldsSchema
  .partial()
  .extend({ roleId: z.string().uuid() })
  .strict();

/**
 * SERVER ACTION (RP-REQ-003): edits a role. Fields left out are unchanged.
 * Needs roles.manage; the RPC refuses a role above the caller (rule 2) and
 * grant or limit changes to the caller's own role (rule 5).
 */
export async function updateRoleAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "roles.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the role's fields." };

  const { roleId, ...fields } = parsed.data;
  const result = await updateRole(auth.supabase, roleId, fields);
  if (!result.ok) return { ok: false, error: result.error };

  await eventCaptureServer({ event: PostHogEvent.CompanyRoleUpdated, distinctId: auth.user.id });
  return { ok: true };
}
