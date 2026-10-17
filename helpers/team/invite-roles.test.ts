import { describe, expect, it } from "vitest";
import type { CompanyRoleView } from "@/helpers/companies/list-roles";
import { ADMIN_A, MEMBER_A, OWNER_A, ROLES_A, memberWith, type RoleFixture } from "@/test/utils/team";
import { inviteRoleOptions } from "./invite-roles";

const view = (role: RoleFixture, withinCeiling = true): CompanyRoleView => ({
  id: role.id,
  name: role.name,
  description: null,
  color: role.color,
  templateKey: role.templateKey,
  isDefault: role.templateKey === "member",
  memberCount: 0,
  inviteCount: 0,
  members: [],
  grants: [...role.grants].map(([key, scope]) => ({ key, scope })),
  limits: role.limits,
  updatedAt: null,
  withinCeiling,
});

const kinds = (options: ReturnType<typeof inviteRoleOptions>, kind: "role" | "template") =>
  options.filter((o) => o.kind === kind).map((o) => o.name);

describe("inviteRoleOptions", () => {
  it("offers the company's roles, then the templates it has no role for yet", () => {
    const options = inviteRoleOptions(OWNER_A.myCompany, [view(ROLES_A.admin), view(ROLES_A.member)]);

    expect(kinds(options, "role")).toEqual(["Admin", "Member"]);
    expect(kinds(options, "template")).toEqual(["Recruiter", "Hiring manager", "Interviewer", "Coordinator", "Finance"]);
  });

  it("leaves out roles above the ceiling and templates the company already has", () => {
    const roles = [view(ROLES_A.admin, false), view(ROLES_A.member), view(ROLES_A.hiringManager)];
    const options = inviteRoleOptions(OWNER_A.myCompany, roles);

    expect(kinds(options, "role")).toEqual(["Member", "Hiring manager"]);
    expect(kinds(options, "template")).not.toContain("Hiring manager");
    expect(kinds(options, "template")).not.toContain("Admin");
  });

  it("offers templates only with roles.manage, and only within the inviter's ceiling", () => {
    const inviter = memberWith(["team.invite", "roles.view"]).myCompany;
    expect(kinds(inviteRoleOptions(inviter, [view(ROLES_A.member)]), "template")).toEqual([]);
    expect(kinds(inviteRoleOptions(MEMBER_A.myCompany, []), "template")).toEqual([]);

    const narrow = memberWith(["team.invite", "roles.manage", "billing.view"]).myCompany;
    expect(kinds(inviteRoleOptions(narrow, []), "template")).toEqual(["Finance"]);
    expect(kinds(inviteRoleOptions(ADMIN_A.myCompany, []), "template").length).toBeGreaterThan(0);
  });
});
