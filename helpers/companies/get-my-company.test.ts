import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { mockUser } from "@/test/utils/auth";
import { flushAfter } from "@/test/utils/after";
import { COMPANY_A, COMPANY_B } from "@/test/utils/recruiter";
import { ADMIN_A, HIRING_MANAGER_A, JOB_A1, MEMBER_A, OWNER_A, ROLES_A, membershipOf } from "@/test/utils/team";
import { can } from "./permissions";
import { getMyCompany } from "./get-my-company";

describe("getMyCompany (RP-TEST-005)", () => {
  it("maps my_company_access() for the primary owner", async () => {
    const supabase = createSupabaseMock();
    supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });

    const company = await getMyCompany(supabase.client, COMPANY_A.user);

    expect(company).toEqual(OWNER_A.myCompany);
    expect(company).toMatchObject({ isOwner: true, isPrimaryOwner: true, role: null });
  });

  it.each([ADMIN_A, MEMBER_A])("maps a $label's role, grants and limits", async (member) => {
    const supabase = createSupabaseMock();
    supabase.queueRpc("my_company_access", { data: member.membership, error: null });

    const company = await getMyCompany(supabase.client, member.user);

    expect(company).toMatchObject({
      id: COMPANY_A.id,
      name: COMPANY_A.info.name,
      email: COMPANY_A.info.email,
      displayName: member.row.display_name,
      ownerUserId: COMPANY_A.user.id,
      isOwner: false,
      isPrimaryOwner: false,
      role: { id: member.roleRow!.id, name: member.roleRow!.name, color: member.roleRow!.color },
    });
    expect(company!.grants).toEqual(member.roleRow!.grants);
  });

  it("maps assigned jobs, so scope assigned works (RP-REQ-010)", async () => {
    const supabase = createSupabaseMock();
    supabase.queueRpc("my_company_access", { data: HIRING_MANAGER_A.membership, error: null });

    const company = await getMyCompany(supabase.client, HIRING_MANAGER_A.user);

    expect(company!.assignedJobIds).toEqual(new Set([JOB_A1]));
    expect(can(company, "applicants.view", JOB_A1)).toBe(true);
    expect(can(company, "applicants.view", "b0000000-0000-4000-8000-0000000000a2")).toBe(false);
  });

  it("maps limits and drops unknown keys and grants (RP-SEC-003)", async () => {
    const supabase = createSupabaseMock();
    supabase.queueRpc("my_company_access", {
      data: {
        ...membershipOf(COMPANY_A, { isOwner: false, role: ROLES_A.member, userId: MEMBER_A.user.id }),
        grants: [
          { key: "jobs.view", scope: "all" },
          { key: "billing.manage", scope: "all" },
          { key: "notes.view", scope: "everything" },
        ],
        limits: { outreach: 50, seats: 2 },
      },
      error: null,
    });

    const company = await getMyCompany(supabase.client, MEMBER_A.user);

    expect([...company!.grants]).toEqual([["jobs.view", "all"]]);
    expect(company!.limits).toEqual({ outreach: 50 });
  });

  it("gives owners no grants or limits of their own (RP-DEC-001)", async () => {
    const supabase = createSupabaseMock();
    supabase.queueRpc("my_company_access", {
      data: { ...OWNER_A.membership, grants: [{ key: "jobs.view", scope: "assigned" }], limits: { outreach: 1 } },
      error: null,
    });

    const company = await getMyCompany(supabase.client, COMPANY_A.user);

    expect(company!.grants.size).toBe(0);
    expect(company!.limits).toEqual({});
    expect(can(company, "billing.view")).toBe(true);
  });

  it("calls the RPC with no arguments: the company is always the caller's", async () => {
    const supabase = createSupabaseMock();
    supabase.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });

    await getMyCompany(supabase.client, MEMBER_A.user);

    expect(supabase.callsFor("my_company_access")[0].chain).toEqual([{ method: "rpc", args: ["my_company_access"] }]);
    expect(supabase.callsFor("company_info")).toHaveLength(0);
  });

  it("returns null for a company user without a membership (a removed member)", async () => {
    const supabase = createSupabaseMock();
    supabase.queueRpc("my_company_access", { data: null, error: null });

    expect(await getMyCompany(supabase.client, COMPANY_B.user)).toBeNull();
    expect(supabase.callsFor("touch_company_membership")).toHaveLength(0);
  });

  it("returns null for an applicant without querying", async () => {
    const supabase = createSupabaseMock();

    expect(await getMyCompany(supabase.client, mockUser({ type: "applicant" }))).toBeNull();
    expect(supabase.calls).toHaveLength(0);
  });

  it("throws on a database error instead of returning null", async () => {
    const supabase = createSupabaseMock();
    supabase.queueRpc("my_company_access", { data: null, error: { message: "boom" } });

    await expect(getMyCompany(supabase.client, COMPANY_A.user)).rejects.toThrow();
  });

  it("touches last_active_at once, after the response", async () => {
    const supabase = createSupabaseMock();
    supabase.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });

    await getMyCompany(supabase.client, MEMBER_A.user);
    expect(supabase.callsFor("touch_company_membership")).toHaveLength(0);

    await flushAfter();
    expect(supabase.callsFor("touch_company_membership")).toHaveLength(1);
  });

  it("ignores an error from the touch", async () => {
    const supabase = createSupabaseMock();
    supabase.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });
    supabase.queueRpc("touch_company_membership", { data: null, error: { message: "boom" } });

    expect(await getMyCompany(supabase.client, MEMBER_A.user)).toEqual(MEMBER_A.myCompany);
    await expect(flushAfter()).resolves.toBeUndefined();
  });
});
