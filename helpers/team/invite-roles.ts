import type { CompanyRoleView } from "@/helpers/companies/list-roles";
import { can, isWithinCeiling, type CompanyAccess } from "@/helpers/companies/permissions";
import { ROLE_TEMPLATES, templateGrants, type RoleTemplateKey } from "@/helpers/companies/role-templates";

/**
 * A choice in the invite dialog's role picker: one of the company's roles, or
 * a template the company has no role for yet. Inviting with a template creates
 * that role first (`inviteMemberAction`).
 */
export type InviteRoleOption =
  | { kind: "role"; id: string; name: string; description: string | null; isDefault: boolean }
  | { kind: "template"; key: RoleTemplateKey; name: string; description: string };

/** The role editor, opened from the invite dialog to make a custom role. */
export const NEW_ROLE_FOR_INVITE_HREF = "/company/settings/roles/new?next=invite";

/** Back to the team page with the invite dialog open and `roleId` picked. */
export const inviteWithRoleHref = (roleId: string) =>
  `/company/settings/team?invite=${encodeURIComponent(roleId)}`;

/**
 * The invite picker (RP-REQ-007/013): the company's roles within the inviter's
 * ceiling, then, for inviters with roles.manage, the templates (RP-REQ-005)
 * with no role yet, also within the ceiling. Every company is seeded with only
 * Admin and Member, so without the templates the picker offered just those two.
 */
export function inviteRoleOptions(viewer: CompanyAccess, roles: CompanyRoleView[] | null): InviteRoleOption[] {
  const list = roles ?? [];
  const existing: InviteRoleOption[] = list
    .filter((r) => r.withinCeiling)
    .map((r) => ({ kind: "role", id: r.id, name: r.name, description: r.description, isDefault: r.isDefault }));
  if (!can(viewer, "roles.manage")) return existing;

  const usedKeys = new Set(list.map((r) => r.templateKey));
  const usedNames = new Set(list.map((r) => r.name.trim().toLowerCase()));
  const templates: InviteRoleOption[] = ROLE_TEMPLATES.filter(
    (t) =>
      !usedKeys.has(t.key) &&
      !usedNames.has(t.name.toLowerCase()) &&
      isWithinCeiling(viewer, templateGrants(t)),
  ).map((t) => ({ kind: "template", key: t.key, name: t.name, description: t.description }));
  return [...existing, ...templates];
}
