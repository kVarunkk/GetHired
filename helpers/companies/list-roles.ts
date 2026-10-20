import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "./get-my-company";
import {
  isPermissionKey,
  isWithinCeiling,
  ROLE_LIMIT_KEYS,
  type PermissionGrant,
  type RoleLimits,
} from "./permissions";

/** A company role as the Roles pages, the team table and the agent see it (RP-REQ-014). */
export type CompanyRoleView = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  templateKey: string | null;
  isDefault: boolean;
  memberCount: number;
  inviteCount: number;
  members: { userId: string; name: string | null }[];
  grants: PermissionGrant[];
  limits: RoleLimits;
  updatedAt: string | null;
  /** RP-REQ-012 rules 2–3: the viewer may edit, delete, assign and invite with it. */
  withinCeiling: boolean;
};

type RawRole = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  template_key: string | null;
  is_default: boolean;
  member_count: number;
  invite_count: number;
  members: { user_id: string; name: string | null }[] | null;
  grants: { key: string; scope: string }[] | null;
  limits: Record<string, number> | null;
  updated_at: string | null;
};

export function toRoleView(raw: RawRole, viewer: MyCompany): CompanyRoleView {
  const grants: PermissionGrant[] = (raw.grants ?? [])
    .filter((g) => isPermissionKey(g.key) && (g.scope === "all" || g.scope === "assigned"))
    .map((g) => ({ key: g.key as PermissionGrant["key"], scope: g.scope as PermissionGrant["scope"] }));
  const limits: RoleLimits = {};
  for (const key of ROLE_LIMIT_KEYS) {
    if (typeof raw.limits?.[key] === "number") limits[key] = raw.limits[key];
  }
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    color: raw.color,
    templateKey: raw.template_key,
    isDefault: Boolean(raw.is_default),
    memberCount: Number(raw.member_count ?? 0),
    inviteCount: Number(raw.invite_count ?? 0),
    members: (raw.members ?? []).map((m) => ({ userId: m.user_id, name: m.name })),
    grants,
    limits,
    updatedAt: raw.updated_at,
    withinCeiling: isWithinCeiling(viewer, grants, limits),
  };
}

/**
 * The session company's roles with member counts, grants and limits, for
 * roles.view (`list_company_roles`, scoped to the caller's company in SQL).
 * Null when the viewer can't see roles.
 */
export async function listRoles(
  supabase: SupabaseClient<Database>,
  viewer: MyCompany,
): Promise<CompanyRoleView[] | null> {
  const { data, error } = await supabase.rpc("list_company_roles");
  if (error) throw new Error(`Failed to load the roles: ${error.message}`);
  if (data === null) return null;
  return (data as unknown as RawRole[]).map((r) => toRoleView(r, viewer));
}
