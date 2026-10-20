import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import {
  ADMIN_A,
  HIRING_MANAGER_A,
  JOB_A1,
  JOB_A2,
  MEMBER_A,
  OWNER_A,
  memberOf,
  memberWith,
  type MemberFixture,
} from "@/test/utils/team";
import { requireCompany, requireCompanyForAction } from "./require-company";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

let supabase: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
});

async function signInAs(member: MemberFixture) {
  await setRequestUser(member.user, supabase.client);
  supabase.queueRpc("my_company_access", { data: member.membership, error: null });
}

describe("requireCompany", () => {
  it("responds 401 without a user", async () => {
    await setRequestUser(null, supabase.client);

    const auth = await requireCompany();

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(401);
  });

  it("responds 403 for an applicant", async () => {
    await setRequestUser(mockUser({ type: "applicant" }), supabase.client);

    const auth = await requireCompany();

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(403);
  });

  it("responds 403 no_membership for a company user without a membership", async () => {
    await setRequestUser(COMPANY_A.user, supabase.client);
    supabase.queueRpc("my_company_access", { data: null, error: null });

    const auth = await requireCompany();

    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(403);
      expect(auth.reason).toBe("no_membership");
      expect(await auth.response.json()).toEqual({
        error: "You're no longer part of a company on GetHired. Ask your team for a new invite.",
      });
    }
  });

  it("returns the user, the RLS client and the company", async () => {
    await signInAs(OWNER_A);

    const auth = await requireCompany();

    expect(auth).toMatchObject({
      ok: true,
      user: COMPANY_A.user,
      company: { id: COMPANY_A.id, isOwner: true },
    });
    if (auth.ok) expect(auth.supabase).toBe(supabase.client);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each([OWNER_A, ADMIN_A, MEMBER_A])("lets every member through with no option ($label)", async (member) => {
    await signInAs(member);

    expect((await requireCompany()).ok).toBe(true);
  });

  it("refuses a missing permission with the catalog's message (RP-TEST-005)", async () => {
    await signInAs(MEMBER_A);

    const auth = await requireCompany({ permission: "jobs.edit" });

    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.response.status).toBe(403);
      expect(auth.reason).toBe("permission");
      expect(await auth.response.json()).toEqual({ error: "Your role can't edit job posts." });
    }
  });

  it.each([OWNER_A, ADMIN_A])("lets a $label through with the permission", async (member) => {
    await signInAs(member);

    expect((await requireCompany({ permission: "jobs.edit" })).ok).toBe(true);
  });

  describe("job scope", () => {
    it("checks the scope against the job", async () => {
      await signInAs(HIRING_MANAGER_A);
      expect((await requireCompany({ permission: "applicants.view", jobId: JOB_A1 })).ok).toBe(true);

      await signInAs(HIRING_MANAGER_A);
      const auth = await requireCompany({ permission: "applicants.view", jobId: JOB_A2 });
      expect(auth.ok).toBe(false);
      if (!auth.ok) {
        expect(await auth.response.json()).toEqual({ error: "Your role can't view applicants for this job." });
      }
    });

    it("needs scope all for a row without a job (jobId: null)", async () => {
      await signInAs(HIRING_MANAGER_A);
      expect((await requireCompany({ permission: "outreach.view", jobId: null })).ok).toBe(false);

      await signInAs(MEMBER_A);
      expect((await requireCompany({ permission: "outreach.view", jobId: null })).ok).toBe(true);
    });

    it("takes any scope when no job is named (a list RLS filters)", async () => {
      await signInAs(HIRING_MANAGER_A);
      expect((await requireCompany({ permission: "applicants.view" })).ok).toBe(true);
    });
  });

  describe("owner: true", () => {
    it.each([ADMIN_A, MEMBER_A])("refuses a $label", async (member) => {
      await signInAs(member);

      const auth = await requireCompany({ owner: true });

      expect(auth.ok).toBe(false);
      if (!auth.ok) {
        expect(auth.response.status).toBe(403);
        expect(await auth.response.json()).toEqual({ error: "Only the company's owners can do this." });
      }
    });

    it("lets every owner through, not only the primary one (RP-DEC-002)", async () => {
      await signInAs(memberOf(COMPANY_A, "custom", { isOwner: true }));
      expect((await requireCompany({ owner: true })).ok).toBe(true);
    });

    it("refuses an Admin-like role even with every permission", async () => {
      await signInAs(memberWith(["billing.view", "roles.manage", "team.assign_roles"]));
      expect((await requireCompany({ owner: true })).ok).toBe(false);
    });
  });

  it("takes permissions from the database, not app_metadata (RP-SEC-004)", async () => {
    const claimsOwner = {
      ...MEMBER_A.user,
      app_metadata: { ...MEMBER_A.user.app_metadata, role: "owner", permissions: ["jobs.edit"] },
    };
    await setRequestUser(claimsOwner, supabase.client);
    supabase.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });

    expect((await requireCompany({ owner: true })).ok).toBe(false);
    supabase.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });
    expect((await requireCompany({ permission: "jobs.edit" })).ok).toBe(false);
  });
});

describe("requireCompanyForAction", () => {
  it("returns an error without a user", async () => {
    await setRequestUser(null, supabase.client);

    expect(await requireCompanyForAction()).toEqual({
      ok: false,
      error: expect.any(String),
      reason: "unauthenticated",
    });
  });

  it("returns an error for an applicant", async () => {
    await setRequestUser(mockUser({ type: "applicant" }), supabase.client);

    expect(await requireCompanyForAction()).toMatchObject({ ok: false, error: expect.any(String) });
    expect(supabase.calls).toHaveLength(0);
  });

  it("asks a company user who hasn't onboarded to set up first", async () => {
    await setRequestUser(mockUser({ type: "company", onboardingComplete: false }), supabase.client);
    supabase.queueRpc("my_company_access", { data: null, error: null });

    expect(await requireCompanyForAction()).toEqual({
      ok: false,
      error: "Set up your company profile first.",
      reason: "no_membership",
    });
  });

  it("returns the user, the RLS client and the company", async () => {
    await signInAs(OWNER_A);

    const auth = await requireCompanyForAction();

    expect(auth).toMatchObject({ ok: true, user: COMPANY_A.user, company: { id: COMPANY_A.id } });
    if (auth.ok) expect(auth.supabase).toBe(supabase.client);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("refuses a member without the permission", async () => {
    await signInAs(MEMBER_A);

    expect(await requireCompanyForAction({ permission: "settings.templates" })).toEqual({
      ok: false,
      error: "Your role can't edit email templates.",
      reason: "permission",
    });
  });

  it("lets only owners through where an owner is required", async () => {
    await signInAs(ADMIN_A);
    expect((await requireCompanyForAction({ owner: true })).ok).toBe(false);

    await signInAs(OWNER_A);
    expect((await requireCompanyForAction({ owner: true })).ok).toBe(true);
  });
});
