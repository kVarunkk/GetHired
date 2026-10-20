"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { roleFieldsSchema } from "@/helpers/companies/role-input";
import { createRole } from "@/helpers/companies/role-rpc";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

const inputSchema = roleFieldsSchema.extend({ templateKey: z.string().max(40).nullish() }).strict();

/**
 * SERVER ACTION (RP-REQ-003): creates a role, blank, from a template or as a
 * duplicate. Needs roles.manage; the RPC adds dependencies (RP-REQ-009) and
 * refuses anything above the caller's own role (RP-REQ-012 rule 1).
 */
export async function createRoleAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "roles.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the role's fields." };

  const result = await createRole(auth.supabase, parsed.data);
  if (!result.ok) return { ok: false, error: result.error };

  await eventCaptureServer({
    event: PostHogEvent.CompanyRoleCreated,
    distinctId: auth.user.id,
    properties: { template: parsed.data.templateKey ?? null, permissions: parsed.data.grants.length },
  });
  return { ok: true, id: result.id };
}
