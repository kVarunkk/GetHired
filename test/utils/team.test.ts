import { describe, expect, it } from "vitest";
import { can } from "@/helpers/companies/permissions";
import { ADMIN_KEYS, MEMBER_KEYS } from "@/helpers/companies/role-templates";
import { COMPANY_A, COMPANY_B, PRIVATE_APPLIED_TO_A, PRIVATE_NOT_APPLIED, PUBLIC_APPLICANT } from "./recruiter";
import {
  ADMIN_A,
  ADMIN_ACCESS,
  HIRING_MANAGER_A,
  JOB_A1,
  JOB_A2,
  MEMBER_A,
  MEMBER_ACCESS,
  MEMBER_B,
  OWNER_A,
  ROLES_A,
  accessOf,
  inviteOf,
  memberOf,
  memberWith,
  roleOf,
  sha256Hex,
} from "./team";

describe("team fixtures", () => {
  it("has one primary owner per company, and it's the company fixture's user", () => {
    const members = [OWNER_A, ADMIN_A, MEMBER_A, MEMBER_B];
    const owners = members.filter((m) => m.company === COMPANY_A && m.myCompany.isOwner);

    expect(owners).toEqual([OWNER_A]);
    expect(OWNER_A.user).toBe(COMPANY_A.user);
    expect(OWNER_A.myCompany).toMatchObject({ isOwner: true, isPrimaryOwner: true, role: null });
    expect(memberOf(COMPANY_B, "owner").user).toBe(COMPANY_B.user);
  });

  it("gives Admin and Member the RP-REQ-004 roles", () => {
    expect([...ADMIN_A.myCompany.grants.keys()].sort()).toEqual([...ADMIN_KEYS].sort());
    expect([...MEMBER_A.myCompany.grants.keys()].sort()).toEqual([...MEMBER_KEYS].sort());
    expect(ADMIN_ACCESS.grants).toEqual(ADMIN_A.myCompany.grants);
    expect(MEMBER_ACCESS.grants).toEqual(MEMBER_A.myCompany.grants);
    expect(MEMBER_A.myCompany.role).toEqual({ id: ROLES_A.member.id, name: "Member", color: "slate" });
  });

  it("returns what getMyCompany would for each member, and the matching RPC payload", () => {
    expect(MEMBER_A.myCompany).toMatchObject({
      id: COMPANY_A.id,
      name: COMPANY_A.info.name,
      email: COMPANY_A.info.email,
      displayName: "Max Member",
      ownerUserId: COMPANY_A.user.id,
      isOwner: false,
      isPrimaryOwner: false,
    });
    expect(MEMBER_A.membership.company.id).toBe(COMPANY_A.id);
    expect(MEMBER_A.membership.role?.id).toBe(ROLES_A.member.id);
    expect(MEMBER_A.membership.grants).toHaveLength(MEMBER_KEYS.length);
    expect(MEMBER_B.myCompany.id).toBe(COMPANY_B.id);
  });

  it("scopes the Hiring manager to JOB_A1", () => {
    expect(can(HIRING_MANAGER_A.myCompany, "applicants.view", JOB_A1)).toBe(true);
    expect(can(HIRING_MANAGER_A.myCompany, "applicants.view", JOB_A2)).toBe(false);
    expect(can(HIRING_MANAGER_A.myCompany, "billing.view")).toBe(false);
  });

  it("builds access and roles for unit tests", () => {
    expect(can(accessOf({ owner: true }), "billing.view")).toBe(true);
    expect(can(accessOf({ grants: ["jobs.view"] }), "jobs.view")).toBe(true);
    expect(roleOf({ template: "interviewer" }).name).toBe("Interviewer");
    // memberWith adds dependencies, as the role RPCs do.
    expect(memberWith(["jobs.edit"]).myCompany.grants.get("jobs.view")).toBe("all");
  });

  it("makes every member a company user with an id that doesn't collide with recruiter.ts", () => {
    const ids = [
      ...[ADMIN_A, MEMBER_A, MEMBER_B, HIRING_MANAGER_A].map((m) => m.user.id),
      COMPANY_A.id,
      COMPANY_B.id,
      COMPANY_A.user.id,
      COMPANY_B.user.id,
      PUBLIC_APPLICANT.id,
      PRIVATE_APPLIED_TO_A.id,
      PRIVATE_NOT_APPLIED.id,
    ];

    expect(new Set(ids).size).toBe(ids.length);
    for (const m of [ADMIN_A, MEMBER_A, MEMBER_B]) expect(m.user.app_metadata.type).toBe("company");
  });

  it("stores the invite token's SHA-256, never the token", () => {
    const { token, row } = inviteOf();

    expect(row.token_hash).toBe(sha256Hex(token));
    expect(row.token_hash).not.toContain(token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.role_id).toBe(ROLES_A.member.id);
    expect(inviteOf().row.id).not.toBe(row.id);
  });
});
