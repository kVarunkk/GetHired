import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgentUser, requireApplicant } from "./auth";
import { COMPANY_A } from "@/test/utils/recruiter";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
});

describe("requireApplicant", () => {
  it("returns the applicant and a request-scoped client", async () => {
    const user = mockUser({ id: "u1" });
    await setRequestUser(user, supabase.client);

    expect(await requireApplicant()).toEqual({ ok: true, user, supabase: supabase.client });
  });

  it("responds 401 without a user", async () => {
    await setRequestUser(null, supabase.client);

    const result = await requireApplicant();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    expect(await result.response.json()).toEqual({ error: "Unauthorized" });
  });

  it("responds 403 for company users", async () => {
    await setRequestUser(mockUser({ type: "company" }), supabase.client);

    const result = await requireApplicant();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({
      error: "The agent is only available to job seekers.",
    });
  });
});

describe("requireAgentUser (RA-TEST-003)", () => {
  it("returns an applicant without looking up a company", async () => {
    const user = mockUser({ id: "u1" });
    await setRequestUser(user, supabase.client);

    expect(await requireAgentUser()).toEqual({
      ok: true,
      user,
      supabase: supabase.client,
      role: "applicant",
      company: null,
    });
    expect(supabase.callsFor("company_info")).toHaveLength(0);
  });

  it("returns an onboarded company user with their company from the session", async () => {
    await setRequestUser(COMPANY_A.user, supabase.client);
    supabase.queue("company_info", {
      data: { id: COMPANY_A.id, name: "Acme", email: "hr@acme.dev" },
      error: null,
    });

    const result = await requireAgentUser();

    expect(result).toMatchObject({
      ok: true,
      role: "company",
      company: { id: COMPANY_A.id, name: "Acme" },
    });
    expect(supabase.callsFor("company_info")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", COMPANY_A.user.id],
    });
  });

  it.each([
    ["hasn't finished onboarding", mockUser({ type: "company", onboardingComplete: false }), true],
    ["has no company row", mockUser({ type: "company" }), false],
  ])("responds 403 for a company that %s", async (_label, user, hasRow) => {
    await setRequestUser(user, supabase.client);
    supabase.queue("company_info", {
      data: hasRow ? { id: COMPANY_A.id, name: "Acme", email: null } : null,
      error: null,
    });

    const result = await requireAgentUser();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({
      error: "Finish setting up your company first.",
    });
  });

  it("responds 403 for users without a role", async () => {
    const user = mockUser();
    user.app_metadata = {};
    await setRequestUser(user, supabase.client);

    const result = await requireAgentUser();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
  });

  it("responds 401 without a user", async () => {
    await setRequestUser(null, supabase.client);

    const result = await requireAgentUser();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
  });
});
