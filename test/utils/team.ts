import { createHash } from "node:crypto";
import { describe } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import {
  expandDependencies,
  grantList,
  type CompanyAccess,
  type Grants,
  type PermissionGrant,
  type PermissionKey,
  type PermissionScope,
  type RoleLimits,
} from "@/helpers/companies/permissions";
import { roleTemplate, templateGrants, type RoleTemplateKey } from "@/helpers/companies/role-templates";
import { mockUser } from "./auth";
import { COMPANY_A, COMPANY_B, type CompanyFixture } from "./recruiter";

type Tables = Database["public"]["Tables"];
type CompanyMemberRow = Tables["company_members"]["Row"];
type CompanyInviteRow = Tables["company_invites"]["Row"];

const CREATED_AT = "2026-01-01T00:00:00.000Z";

/** Jobs of company A, for job scope (RP-REQ-010): the Hiring manager is on A1 only. */
export const JOB_A1 = "b0000000-0000-4000-8000-0000000000a1";
export const JOB_A2 = "b0000000-0000-4000-8000-0000000000a2";

export type RoleFixture = {
  id: string;
  name: string;
  color: string;
  templateKey: RoleTemplateKey | null;
  grants: Grants;
  limits: RoleLimits;
};

/** A company role row, as `MyCompany.role` and the role lists carry it. */
export function roleOf(
  overrides: Partial<RoleFixture> & { template?: RoleTemplateKey } = {},
): RoleFixture {
  const template = overrides.template ? roleTemplate(overrides.template) : undefined;
  return {
    id: overrides.id ?? "f9000000-0000-4000-8000-000000000001",
    name: overrides.name ?? template?.name ?? "Custom",
    color: overrides.color ?? template?.color ?? "slate",
    templateKey: overrides.templateKey ?? overrides.template ?? null,
    grants: overrides.grants ?? (template ? templateGrants(template) : new Map()),
    limits: overrides.limits ?? {},
  };
}

/** The seeded roles of company A and B (RP-REQ-004), with fixed ids. */
export function companyRoles(company: CompanyFixture) {
  const n = company.id.slice(-1);
  return {
    admin: roleOf({ template: "admin", id: `f2000000-0000-4000-8000-00000000000${n}` }),
    member: roleOf({ template: "member", id: `f3000000-0000-4000-8000-00000000000${n}` }),
    hiringManager: roleOf({ template: "hiring_manager", id: `f5000000-0000-4000-8000-00000000000${n}` }),
  };
}

export const ROLES_A = companyRoles(COMPANY_A);

/** A `CompanyAccess` for unit tests of `can` and of the code that calls it. */
export function accessOf({
  owner = false,
  grants = [],
  assignedJobIds = [],
  limits = {},
}: {
  owner?: boolean;
  grants?: Iterable<PermissionGrant | PermissionKey> | Grants;
  assignedJobIds?: string[];
  limits?: RoleLimits;
} = {}): CompanyAccess {
  const map =
    grants instanceof Map
      ? new Map(grants)
      : new Map(
          [...(grants as Iterable<PermissionGrant | PermissionKey>)].map((g) =>
            typeof g === "string" ? [g, "all" as PermissionScope] : [g.key, g.scope],
          ),
        );
  return { isOwner: owner, grants: map, assignedJobIds: new Set(assignedJobIds), limits };
}

export const OWNER_ACCESS = accessOf({ owner: true });
export const ADMIN_ACCESS = accessOf({ grants: ROLES_A.admin.grants });
export const MEMBER_ACCESS = accessOf({ grants: ROLES_A.member.grants });

export type MemberLabel = "owner" | "admin" | "member" | "hiring_manager" | "custom";

export type MemberFixture = {
  company: CompanyFixture;
  /** A label for test names (`asEachMember`); access comes from `role`/`access`. */
  label: MemberLabel;
  /** @deprecated use `label`; kept so `$role` in test names keeps reading well. */
  role: MemberLabel;
  user: User;
  row: CompanyMemberRow;
  /** The member's role row, null for owners (RP-DEC-001). */
  roleRow: RoleFixture | null;
  access: CompanyAccess;
  /** What `getMyCompany` returns for this member. */
  myCompany: MyCompany;
  /** What `my_company_access()` returns for this member (getMyCompany's one round trip). */
  membership: ReturnType<typeof membershipOf>;
};

/** The `my_company_access()` payload for a member of `company`. */
export function membershipOf(
  company: CompanyFixture,
  {
    userId = company.info.user_id!,
    isOwner = true,
    role = null,
    displayName = null,
    assignedJobIds = [],
  }: {
    userId?: string;
    isOwner?: boolean;
    role?: RoleFixture | null;
    displayName?: string | null;
    assignedJobIds?: string[];
  } = {},
) {
  return {
    company: {
      id: company.id,
      name: company.info.name,
      email: company.info.email,
      user_id: company.info.user_id,
    },
    display_name: displayName,
    is_owner: isOwner,
    is_primary_owner: company.info.user_id === userId,
    role: role ? { id: role.id, name: role.name, color: role.color } : null,
    grants: isOwner || !role ? [] : grantList(role.grants),
    assigned_job_ids: assignedJobIds,
    limits: isOwner || !role ? {} : role.limits,
  };
}

/** What `getMyCompany` returns for a member of `company`. */
export function myCompanyOf(
  company: CompanyFixture,
  {
    userId = company.info.user_id!,
    isOwner = true,
    role = null,
    displayName = null,
    assignedJobIds = [],
  }: {
    userId?: string;
    isOwner?: boolean;
    role?: RoleFixture | null;
    displayName?: string | null;
    assignedJobIds?: string[];
  } = {},
): MyCompany {
  return {
    id: company.id,
    name: company.info.name,
    email: company.info.email,
    displayName,
    ownerUserId: company.info.user_id!,
    isOwner,
    isPrimaryOwner: company.info.user_id === userId,
    role: role ? { id: role.id, name: role.name, color: role.color } : null,
    grants: isOwner || !role ? new Map() : new Map(role.grants),
    assignedJobIds: new Set(assignedJobIds),
    limits: isOwner || !role ? {} : role.limits,
  };
}

const ID_PREFIX: Record<MemberLabel, string> = {
  owner: "c1",
  admin: "c2",
  member: "c3",
  hiring_manager: "c5",
  custom: "c6",
};

const DISPLAY_NAME: Record<MemberLabel, string> = {
  owner: "Olive Owner",
  admin: "Ada Admin",
  member: "Max Member",
  hiring_manager: "Hank Hiring",
  custom: "Cass Custom",
};

/**
 * A user who is a member of `company`. Owners reuse the company fixture's
 * user (the primary owner); others get their own ids (`c2…` admins, `c3…`
 * members, `c5…` hiring managers, `c6…` custom roles, numbered by company
 * like `test/utils/recruiter.ts`).
 */
export function memberOf(
  company: CompanyFixture,
  label: MemberLabel,
  overrides: {
    id?: string;
    email?: string;
    displayName?: string | null;
    role?: RoleFixture;
    assignedJobIds?: string[];
    isOwner?: boolean;
  } = {},
): MemberFixture {
  const n = company.id.slice(-1);
  const domain = company.info.email!.split("@")[1];
  const isOwner = overrides.isOwner ?? label === "owner";
  const user =
    label === "owner" && !overrides.id
      ? company.user
      : mockUser({
          type: "company",
          id: overrides.id ?? `${ID_PREFIX[label]}000000-0000-4000-8000-00000000000${n}`,
          email: overrides.email ?? `${label}@${domain}`,
        });
  const displayName = overrides.displayName !== undefined ? overrides.displayName : DISPLAY_NAME[label];
  const roles = companyRoles(company);
  const roleRow = isOwner
    ? null
    : (overrides.role ??
      (label === "admin" ? roles.admin : label === "hiring_manager" ? roles.hiringManager : roles.member));
  const assignedJobIds = overrides.assignedJobIds ?? [];
  const opts = { userId: user.id, isOwner, role: roleRow, displayName, assignedJobIds };
  const myCompany = myCompanyOf(company, opts);

  return {
    company,
    label,
    role: label,
    user,
    row: {
      company_id: company.id,
      user_id: user.id,
      is_owner: isOwner,
      role_id: roleRow?.id ?? null,
      display_name: displayName,
      created_at: CREATED_AT,
      last_active_at: null,
    },
    roleRow,
    access: myCompany,
    myCompany,
    membership: membershipOf(company, opts),
  };
}

export const OWNER_A = memberOf(COMPANY_A, "owner");
export const ADMIN_A = memberOf(COMPANY_A, "admin");
export const MEMBER_A = memberOf(COMPANY_A, "member");
export const MEMBER_B = memberOf(COMPANY_B, "member");
/** RP-REQ-010: the Hiring manager template, assigned to JOB_A1 only. */
export const HIRING_MANAGER_A = memberOf(COMPANY_A, "hiring_manager", { assignedJobIds: [JOB_A1] });

/** A member of company A whose role grants `grants`, plus their dependencies (RP-REQ-009). */
export function memberWith(
  grants: (PermissionGrant | PermissionKey)[],
  overrides: { assignedJobIds?: string[]; limits?: RoleLimits; name?: string } = {},
): MemberFixture {
  const expanded = expandDependencies(grantList(accessOf({ grants }).grants));
  return memberOf(COMPANY_A, "custom", {
    role: roleOf({ name: overrides.name ?? "Custom", grants: expanded, limits: overrides.limits ?? {} }),
    assignedJobIds: overrides.assignedJobIds,
  });
}

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

let inviteSeq = 0;

/** A `company_invites` row plus the token whose SHA-256 is its `token_hash`. */
export function inviteOf(overrides: Partial<CompanyInviteRow> & { token?: string } = {}) {
  inviteSeq += 1;
  const { token = `tok_${inviteSeq.toString().padStart(4, "0")}_${"x".repeat(38)}`, ...rest } = overrides;
  const row: CompanyInviteRow = {
    id: `f1000000-0000-4000-8000-${inviteSeq.toString(16).padStart(12, "0")}`,
    company_id: COMPANY_A.id,
    email: "invitee@gmail.com",
    role_id: ROLES_A.member.id,
    token_hash: sha256Hex(token),
    invited_by: OWNER_A.user.id,
    expires_at: "2099-01-01T00:00:00.000Z",
    accepted_at: null,
    accepted_by: null,
    revoked_at: null,
    created_at: CREATED_AT,
    ...rest,
  };
  return { token, row };
}

/**
 * TM-TEST-005: runs a suite once per member fixture of company A (owner,
 * Admin role, Member role by default), so read-only cases can be checked for
 * each.
 */
export function asEachMember(
  name: string,
  fn: (member: MemberFixture) => void,
  members: MemberFixture[] = [OWNER_A, ADMIN_A, MEMBER_A],
) {
  describe.each(members.map((m) => [m.label, m] as const))(`${name} (as %s)`, (_role, member) => fn(member));
}
