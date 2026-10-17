"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/helpers/companies/permissions";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { createRole } from "@/helpers/companies/role-rpc";
import { ROLE_TEMPLATES, roleTemplate, templateGrants, type RoleTemplateKey } from "@/helpers/companies/role-templates";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { createAndSendInvite, type CreateInviteResult } from "@/helpers/team/send-invite";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    /** Omitted: the company's default invite role (RP-REQ-004). */
    roleId: z.string().uuid().optional(),
    /** A template the company has no role for yet; the role is created first. */
    templateKey: z.enum(ROLE_TEMPLATES.map((t) => t.key) as [RoleTemplateKey, ...RoleTemplateKey[]]).optional(),
  })
  .strict()
  .refine((input) => !(input.roleId && input.templateKey));

/**
 * SERVER ACTION (TM-REQ-002, RP-REQ-007): invites someone by email with one of
 * the company's roles. Needs team.invite; the RPC checks the role is the
 * company's and within the caller's ceiling (RP-REQ-012 rule 3). Inviting with
 * a template also needs roles.manage: the role is reused if the company already
 * has one from that template, otherwise created from it (RP-REQ-005).
 */
export async function inviteMemberAction(input: z.input<typeof inputSchema>): Promise<CreateInviteResult> {
  const auth = await requireCompanyForAction({ permission: "team.invite" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Enter a valid email and choose a role." };
  const { email, templateKey } = parsed.data;
  let roleId = parsed.data.roleId;

  if (templateKey) {
    if (!can(auth.company, "roles.manage")) return { ok: false, error: "Your role doesn't allow this." };
    const resolved = await roleIdForTemplate(auth.supabase, auth.company.id, templateKey);
    if (!resolved.ok) return resolved;
    roleId = resolved.id;
  }

  const result = await createAndSendInvite(auth, { email, roleId });
  if (!result.ok) return result;

  revalidatePath("/company/settings/team");
  await eventCaptureServer({ event: PostHogEvent.TeamMemberInvited, distinctId: auth.user.id });
  return result;
}

async function roleIdForTemplate(
  supabase: Parameters<typeof createRole>[0],
  companyId: string,
  key: RoleTemplateKey,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data: existing } = await supabase
    .from("company_roles")
    .select("id")
    .eq("company_id", companyId)
    .eq("template_key", key)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, id: existing.id };

  const template = roleTemplate(key)!;
  const created = await createRole(supabase, {
    name: template.name,
    description: template.description,
    color: template.color,
    grants: [...templateGrants(template)].map(([k, scope]) => ({ key: k, scope })),
    limits: {},
    templateKey: key,
  });
  return created.ok ? { ok: true, id: created.id } : { ok: false, error: created.error };
}
