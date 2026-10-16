import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { explainMatch } from "@/helpers/matching/explain-match";
import { MATCH_EXPLAIN_TIMEOUT_MS } from "@/helpers/matching/config";
import { setRequestUser } from "@/test/utils/auth";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { CANDIDATE_PROFILE, JOB_POST, RESUME_CONTENT, explanationOf } from "@/test/utils/matching";
import { directoryRowOf } from "@/test/utils/outreach";
import { POST } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ consumeEntitlement: vi.fn() }));
vi.mock("@/helpers/matching/explain-match", () => ({ explainMatch: vi.fn() }));
vi.mock("server-only", () => ({}));

const CANDIDATE_ID = PUBLIC_APPLICANT.id;
const ROW_ID = "f0000000-0000-4000-8000-000000000001";
const BODY = { jobPostId: JOB_POST.id, candidateId: CANDIDATE_ID };

let rls: SupabaseMock;
let admin: SupabaseMock;

async function signInCompany() {
  rls = createSupabaseMock({ user: COMPANY_A.user });
  rls.queue("company_info", {
    data: { id: COMPANY_A.id, name: COMPANY_A.info.name, email: COMPANY_A.info.email },
    error: null,
  });
  await setRequestUser(COMPANY_A.user, rls.client);
}

/** The company owns the job, and the candidate row (or null) and their data. */
function ownsJob(row: Record<string, unknown> | null = { id: ROW_ID, explanation: null, explanation_status: "none" }) {
  rls.queue("job_postings", { data: JOB_POST, error: null });
  rls.queue("job_relevant_profiles", { data: row, error: null });
  admin.queue("user_info", { data: CANDIDATE_PROFILE, error: null });
  admin.queue("resumes", { data: { content: RESUME_CONTENT }, error: null });
}

const post = (body: unknown = BODY) =>
  POST(buildRequest("/api/company/matches/explain", { method: "POST", body }));

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const updatesOf = (db: SupabaseMock) =>
  db
    .callsFor("job_relevant_profiles")
    .filter((c) => has(c, "update"))
    .map((c) => c.chain.find((m) => m.method === "update")!.args[0] as Record<string, unknown>);

const entitlementError = () =>
  new EntitlementError({
    key: "match_explanations",
    kind: "allowance",
    qty: 1,
    used: 50,
    amount: 50,
    overageCredits: null,
    creditBalance: 0,
    creditsNeeded: 0,
    reason: "limit_reached",
    suggestedTier: null,
  });

beforeEach(() => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client);
  vi.mocked(explainMatch).mockResolvedValue({ ok: true, explanation: explanationOf() });
  vi.mocked(consumeEntitlement).mockResolvedValue({ source: "allowance", creditsSpent: 0, duplicate: false });
});

describe("POST /api/company/matches/explain (MT-TEST-005)", () => {
  it("401s without a user", async () => {
    await setRequestUser(null);

    expect((await post()).status).toBe(401);
  });

  it("403s for an applicant", async () => {
    await setRequestUser(PUBLIC_APPLICANT.user, createSupabaseMock().client);

    expect((await post()).status).toBe(403);
  });

  it.each([
    ["no body fields", {}],
    ["a non-UUID job", { ...BODY, jobPostId: "nope" }],
    ["a non-UUID candidate", { ...BODY, candidateId: "1; drop table" }],
  ])("422s for %s", async (_label, body) => {
    await signInCompany();

    const res = await post(body);

    expect(res.status).toBe(422);
    expect(explainMatch).not.toHaveBeenCalled();
  });

  it("404s for another company's job, scoped by the session company", async () => {
    await signInCompany();
    rls.queue("job_postings", { data: null, error: null });

    const res = await post();

    expect(res.status).toBe(404);
    const jobQuery = rls.callsFor("job_postings")[0];
    expect(jobQuery.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(explainMatch).not.toHaveBeenCalled();
  });

  it("404s when the candidate isn't matched and the company can't view them", async () => {
    await signInCompany();
    rls.queue("job_postings", { data: JOB_POST, error: null });
    rls.queue("job_relevant_profiles", { data: null, error: null });
    rls.queueRpc("company_can_view_candidate", { data: false, error: null });

    const res = await post();

    expect(res.status).toBe(404);
    expect(explainMatch).not.toHaveBeenCalled();
    expect(consumeEntitlement).not.toHaveBeenCalled();
  });

  it("returns a cached explanation without a model call or a charge", async () => {
    await signInCompany();
    rls.queue("job_postings", { data: JOB_POST, error: null });
    rls.queue("job_relevant_profiles", {
      data: { id: ROW_ID, explanation: explanationOf(), explanation_status: "completed" },
      error: null,
    });

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ explanation: explanationOf() });
    expect(explainMatch).not.toHaveBeenCalled();
    expect(consumeEntitlement).not.toHaveBeenCalled();
  });

  it("regenerates a stale explanation", async () => {
    await signInCompany();
    ownsJob({ id: ROW_ID, explanation: explanationOf({ summary: "old" }), explanation_status: "stale" });

    const res = await post();

    expect(res.status).toBe(200);
    expect(explainMatch).toHaveBeenCalledTimes(1);
  });

  it("generates, charges after the model call, then stores with the service role", async () => {
    await signInCompany();
    ownsJob();
    const order: string[] = [];
    vi.mocked(explainMatch).mockImplementation(async () => {
      order.push("model");
      return { ok: true, explanation: explanationOf() };
    });
    vi.mocked(consumeEntitlement).mockImplementation(async () => {
      order.push("charge");
      return { source: "allowance", creditsSpent: 0, duplicate: false };
    });

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ explanation: explanationOf() });
    expect(order).toEqual(["model", "charge"]);
    expect(consumeEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "match_explanations",
      1,
      { type: "match_explanation", id: ROW_ID },
      COMPANY_A.user.id,
    );
    expect(updatesOf(admin)).toEqual([
      expect.objectContaining({
        explanation: explanationOf(),
        explanation_status: "completed",
        explanation_error: null,
        explained_at: expect.any(String),
      }),
    ]);
    expect(updatesOf(rls)).toEqual([]);
  });

  it("passes the candidate's profile and primary resume to the model, with a timeout", async () => {
    await signInCompany();
    ownsJob();

    await post();

    expect(explainMatch).toHaveBeenCalledWith(
      { job: JOB_POST, profile: CANDIDATE_PROFILE, resume: RESUME_CONTENT },
      expect.objectContaining({ timeoutMs: MATCH_EXPLAIN_TIMEOUT_MS, abortSignal: expect.any(AbortSignal) }),
    );
    const resumeQuery = admin.callsFor("resumes")[0];
    expect(resumeQuery.chain).toContainEqual({ method: "eq", args: ["user_id", CANDIDATE_ID] });
    expect(resumeQuery.chain).toContainEqual({ method: "eq", args: ["is_primary", true] });
  });

  it("reads a talent-pool candidate from candidate_directory, never user_info (ORT-045)", async () => {
    await signInCompany();
    const row = directoryRowOf();
    rls.queue("job_postings", { data: JOB_POST, error: null });
    rls.queue("job_relevant_profiles", { data: { id: ROW_ID, explanation: null, explanation_status: "none" }, error: null });
    rls.queue("candidate_directory", { data: row, error: null });

    const res = await post();

    expect(res.status).toBe(200);
    const { resume_sections, ...profile } = row;
    expect(explainMatch).toHaveBeenCalledWith(
      { job: JOB_POST, profile, resume: { sections: resume_sections } },
      expect.anything(),
    );
    expect(rls.callsFor("candidate_directory")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", CANDIDATE_ID],
    });
    expect(admin.callsFor("user_info")).toEqual([]);
    expect(admin.callsFor("resumes")).toEqual([]);
  });

  it("402s with nothing stored when the allowance is used up", async () => {
    await signInCompany();
    ownsJob();
    vi.mocked(consumeEntitlement).mockRejectedValue(entitlementError());

    const res = await post();

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "entitlement", key: "match_explanations" });
    expect(updatesOf(admin)).toEqual([]);
  });

  it.each([
    ["model_error", 502],
    ["invalid_output", 502],
    ["timeout", 504],
  ] as const)("on %s, stores the safe code, returns %i and doesn't charge", async (errorCode, status) => {
    await signInCompany();
    ownsJob();
    vi.mocked(explainMatch).mockResolvedValue({ ok: false, errorCode });

    const res = await post();

    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body).toEqual({ error: expect.any(String), code: errorCode });
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(updatesOf(admin)).toEqual([{ explanation_status: "failed", explanation_error: errorCode }]);
  });

  it("explains a viewable candidate with no match row, without storing", async () => {
    await signInCompany();
    rls.queue("job_postings", { data: JOB_POST, error: null });
    rls.queue("job_relevant_profiles", { data: null, error: null });
    rls.queueRpc("company_can_view_candidate", { data: true, error: null });
    admin.queue("user_info", { data: CANDIDATE_PROFILE, error: null });
    admin.queue("resumes", { data: null, error: null });

    const res = await post();

    expect(res.status).toBe(200);
    expect(explainMatch).toHaveBeenCalledWith(
      expect.objectContaining({ resume: null }),
      expect.anything(),
    );
    expect(consumeEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "match_explanations",
      1,
      { type: "match_explanation", id: `${JOB_POST.id}:${CANDIDATE_ID}` },
      COMPANY_A.user.id,
    );
    expect(updatesOf(admin)).toEqual([]);
  });

  it("404s when the candidate's profile is gone", async () => {
    await signInCompany();
    rls.queue("job_postings", { data: JOB_POST, error: null });
    rls.queue("job_relevant_profiles", { data: { id: ROW_ID, explanation: null, explanation_status: "none" }, error: null });
    admin.queue("user_info", { data: null, error: null });

    expect((await post()).status).toBe(404);
    expect(explainMatch).not.toHaveBeenCalled();
  });
});
