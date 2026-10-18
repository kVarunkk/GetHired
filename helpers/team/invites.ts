import "server-only";
import { z } from "zod";
import { can } from "@/helpers/companies/permissions";
import { createRole, type ActorKind } from "@/helpers/companies/role-rpc";
import { ROLE_TEMPLATES, roleTemplate, templateGrants, type RoleTemplateKey } from "@/helpers/companies/role-templates";
import { asTeamRpcResult, teamErrorMessage } from "./errors";
import { createAndSendInvite, type CreateInviteResult } from "./send-invite";

// The invite, resend and revoke logic, shared by the team server actions and
// the recruiter agent's invite tools (helpers/agent/roles/recruiter/tools/roles.ts).
// The caller has already checked team.invite for the session company.

type Deps = Parameters<typeof createAndSendInvite>[0];

export const inviteTemplateKeySchema = z.enum(
  ROLE_TEMPLATES.map((t) => t.key) as [RoleTemplateKey, ...RoleTemplateKey[]],
);

/**
 * Invites `email` with one of the company's roles (none: the default role).
 * Inviting with a template also needs roles.manage: the role is reused if the
 * company already has one from that template, otherwise created from it
 * (RP-REQ-005).
 */
export async function inviteMember(
  deps: Deps,
  { email, roleId, templateKey }: { email: string; roleId?: string; templateKey?: RoleTemplateKey },
  actorKind: ActorKind = "user",
): Promise<CreateInviteResult> {
  let role = roleId;
  if (templateKey) {
    if (!can(deps.company, "roles.manage")) return { ok: false, error: teamErrorMessage("forbidden") };
    const resolved = await roleIdForTemplate(deps.supabase, deps.company.id, templateKey, actorKind);
    if (!resolved.ok) return resolved;
    role = resolved.id;
  }
  return createAndSendInvite(deps, { email, roleId: role }, actorKind);
}

/**
 * Resends an open invite with a new token (TM-REQ-002). The old invite is
 * revoked first (its token stops working), then a new one is created for the
 * same email and role (the default role if that role was deleted). Tokens are
 * never stored, so there's nothing to send again.
 */
export async function resendInvite(
  deps: Deps,
  inviteId: string,
  actorKind: ActorKind = "user",
): Promise<CreateInviteResult> {
  const { data: invite, error: loadError } = await deps.supabase
    .from("company_invites")
    .select("id, email, role_id")
    .eq("id", inviteId)
    .eq("company_id", deps.company.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();
  if (loadError) return { ok: false, error: teamErrorMessage("unknown") };
  if (!invite) return { ok: false, error: teamErrorMessage("not_found") };

  const revoked = await revokeInvite(deps.supabase, invite.id, actorKind);
  if (!revoked.ok) return revoked;

  return createAndSendInvite(deps, { email: invite.email, roleId: invite.role_id }, actorKind);
}

/** Revokes an open invite. The RPC scopes it to the caller's company. */
export async function revokeInvite(
  supabase: Deps["supabase"],
  inviteId: string,
  actorKind: ActorKind = "user",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("revoke_company_invite", {
    p_invite_id: inviteId,
    ...(actorKind === "agent" ? { p_actor_kind: actorKind } : {}),
  });
  if (error) return { ok: false, error: teamErrorMessage("unknown") };
  const result = asTeamRpcResult(data);
  if (!result.ok) return { ok: false, error: teamErrorMessage(result.reason) };
  return { ok: true };
}

async function roleIdForTemplate(
  supabase: Deps["supabase"],
  companyId: string,
  key: RoleTemplateKey,
  actorKind: ActorKind,
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
  const created = await createRole(
    supabase,
    {
      name: template.name,
      description: template.description,
      color: template.color,
      grants: [...templateGrants(template)].map(([k, scope]) => ({ key: k, scope })),
      limits: {},
      templateKey: key,
    },
    actorKind,
  );
  return created.ok ? { ok: true, id: created.id } : { ok: false, error: created.error };
}
