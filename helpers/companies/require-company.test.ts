import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { requireCompany, requireCompanyForAction } from "./require-company";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

let supabase: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
});

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

  it("responds 403 for a company user without a company row", async () => {
    await setRequestUser(COMPANY_A.user, supabase.client);
    supabase.queue("company_info", { data: null, error: null });

    const auth = await requireCompany();

    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.response.status).toBe(403);
  });

  it("returns the user, the RLS client and the company", async () => {
    await setRequestUser(COMPANY_A.user, supabase.client);
    supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });

    const auth = await requireCompany();

    expect(auth).toMatchObject({
      ok: true,
      user: COMPANY_A.user,
      company: { id: COMPANY_A.id },
    });
    if (auth.ok) expect(auth.supabase).toBe(supabase.client);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });
});

describe("requireCompanyForAction", () => {
  it("returns an error without a user", async () => {
    await setRequestUser(null, supabase.client);

    expect(await requireCompanyForAction()).toEqual({ ok: false, error: expect.any(String) });
  });

  it("returns an error for an applicant", async () => {
    await setRequestUser(mockUser({ type: "applicant" }), supabase.client);

    expect(await requireCompanyForAction()).toEqual({ ok: false, error: expect.any(String) });
    expect(supabase.callsFor("company_info")).toHaveLength(0);
  });

  it("returns an error for a company user without a company row", async () => {
    await setRequestUser(COMPANY_A.user, supabase.client);
    supabase.queue("company_info", { data: null, error: null });

    expect(await requireCompanyForAction()).toEqual({ ok: false, error: expect.any(String) });
  });

  it("returns the user, the RLS client and the company", async () => {
    await setRequestUser(COMPANY_A.user, supabase.client);
    supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });

    const auth = await requireCompanyForAction();

    expect(auth).toMatchObject({ ok: true, user: COMPANY_A.user, company: { id: COMPANY_A.id } });
    if (auth.ok) expect(auth.supabase).toBe(supabase.client);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });
});
