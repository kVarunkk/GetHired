import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { asEachMember, OWNER_A } from "@/test/utils/team";
import { APPLICATION, screeningResultOf } from "@/test/utils/matching";
import { GET } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));

let rls: SupabaseMock;

async function signInCompany() {
  rls = createSupabaseMock({ user: COMPANY_A.user });
  rls.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(COMPANY_A.user, rls.client);
}

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "f1000000-0000-4000-8000-000000000001",
  application_id: APPLICATION.id,
  status: "completed",
  fit_score: 82,
  recommendation: "yes",
  result: screeningResultOf(),
  error_code: null,
  attempts: 1,
  job_snapshot_hash: "abc",
  completed_at: "2026-10-15T00:00:00Z",
  updated_at: "2026-10-15T00:00:00Z",
  ...overrides,
});

const get = (id = APPLICATION.id) =>
  GET(buildRequest(`/api/company/applications/${id}/screening`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/company/applications/[id]/screening (MTT-073)", () => {
  it("401s without a user", async () => {
    await setRequestUser(null);

    expect((await get()).status).toBe(401);
  });

  it("403s for an applicant", async () => {
    await setRequestUser(PUBLIC_APPLICANT.user, createSupabaseMock().client);

    expect((await get()).status).toBe(403);
  });

  it("404s for an id that isn't a UUID", async () => {
    await signInCompany();

    expect((await get("nope")).status).toBe(404);
  });

  it("404s for an application on another company's job, scoped by the session company", async () => {
    await signInCompany();
    rls.queue("applications", { data: null, error: null });

    const res = await get();

    expect(res.status).toBe(404);
    expect(rls.callsFor("applications")[0].chain).toContainEqual({
      method: "eq",
      args: ["job_postings.company_id", COMPANY_A.id],
    });
    expect(rls.callsFor("application_screenings")).toHaveLength(0);
  });

  it("returns the screening with its result parsed through the schema", async () => {
    await signInCompany();
    rls.queue("applications", { data: { id: APPLICATION.id }, error: null });
    rls.queue("application_screenings", { data: row(), error: null });

    const res = await get();

    expect(res.status).toBe(200);
    const { screening } = await res.json();
    expect(screening).toMatchObject({
      status: "completed",
      fit_score: 82,
      recommendation: "yes",
      result: screeningResultOf(),
      error_code: null,
    });
    expect(rls.callsFor("application_screenings")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
  });

  it("returns a null result when the stored one doesn't match the schema", async () => {
    await signInCompany();
    rls.queue("applications", { data: { id: APPLICATION.id }, error: null });
    rls.queue("application_screenings", { data: row({ result: { junk: true } }), error: null });

    const { screening } = await (await get()).json();

    expect(screening.result).toBeNull();
  });

  it("returns { screening: null } when there is none", async () => {
    await signInCompany();
    rls.queue("applications", { data: { id: APPLICATION.id }, error: null });
    rls.queue("application_screenings", { data: null, error: null });

    expect(await (await get()).json()).toEqual({ screening: null });
  });

  it("returns the safe error_code and never a raw error", async () => {
    await signInCompany();
    rls.queue("applications", { data: { id: APPLICATION.id }, error: null });
    rls.queue("application_screenings", {
      data: row({ status: "failed", result: null, error_code: "model_error", raw_error: "upstream 500" }),
      error: null,
    });

    const body = await (await get()).json();

    expect(body.screening.error_code).toBe("model_error");
    expect(JSON.stringify(body)).not.toContain("upstream 500");
  });

  it("doesn't return previous_result or internal columns", async () => {
    await signInCompany();
    rls.queue("applications", { data: { id: APPLICATION.id }, error: null });
    rls.queue("application_screenings", { data: row({ previous_result: screeningResultOf() }), error: null });

    const { screening } = await (await get()).json();

    expect(screening).not.toHaveProperty("previous_result");
    expect(screening).not.toHaveProperty("job_snapshot_hash");
  });
});

// TM-TEST-005: every member reads screenings.
asEachMember("GET screening", (member) => {
  it("returns the screening", async () => {
    rls = createSupabaseMock({ user: member.user });
    rls.queueRpc("my_company_access", { data: member.membership, error: null });
    await setRequestUser(member.user, rls.client);
    rls.queue("applications", { data: { id: APPLICATION.id }, error: null });
    rls.queue("application_screenings", { data: row(), error: null });

    expect((await get()).status).toBe(200);
  });
});
