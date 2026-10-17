import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAgentUser, requireApplicant } from "./auth";
import { COMPANY_A } from "@/test/utils/recruiter";
import { OWNER_A, memberWith } from "@/test/utils/team";
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
    supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });

    const result = await requireAgentUser();

    expect(result).toMatchObject({
      ok: true,
      role: "company",
      company: { id: COMPANY_A.id, name: "Acme" },
    });
    // The membership is always the caller's: my_company_access() takes no arguments.
    expect(supabase.callsFor("my_company_access")[0].chain).toEqual([{ method: "rpc", args: ["my_company_access"] }]);
  });

  it.each([
    ["hasn't finished onboarding", mockUser({ type: "company", onboardingComplete: false }), true],
    ["has no membership", mockUser({ type: "company" }), false],
  ])("responds 403 for a company that %s", async (_label, user, hasRow) => {
    await setRequestUser(user, supabase.client);
    supabase.queueRpc("my_company_access", { data: hasRow ? OWNER_A.membership : null, error: null });

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

describe("requireAgentUser and agent.use (RP-REQ-030, RPT-080)", () => {
  it("refuses a role without agent.use with 403 and the reason", async () => {
    const member = memberWith(["applicants.view"]);
    await setRequestUser(member.user, supabase.client);
    supabase.queueRpc("my_company_access", { data: member.membership, error: null });

    const result = await requireAgentUser();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    expect(await result.response.json()).toEqual({ error: "Your role doesn't include the recruiter agent." });
  });

  it("lets a role with agent.use through", async () => {
    const member = memberWith(["agent.use"]);
    await setRequestUser(member.user, supabase.client);
    supabase.queueRpc("my_company_access", { data: member.membership, error: null });

    expect(await requireAgentUser()).toMatchObject({ ok: true, role: "company" });
  });
});
