import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateTag } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, COMPANY_B, jobPostingOf } from "@/test/utils/recruiter";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { triggerJobPostingRelevanceUpdate } from "./relevant-profiles-update";
import { assertLimit } from "@/helpers/billing/entitlements";
import { EntitlementError, type EntitlementPayload } from "@/helpers/billing/errors";
import { upsertJobPostingAction } from "./upsert-job-posting";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("./relevant-profiles-update", () => ({ triggerJobPostingRelevanceUpdate: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ assertLimit: vi.fn() }));

const AT_LIMIT: EntitlementPayload = {
  key: "active_job_posts",
  kind: "limit",
  qty: 1,
  used: 2,
  amount: 2,
  overageCredits: null,
  creditBalance: 0,
  creditsNeeded: 0,
  reason: "limit_reached",
  suggestedTier: { slug: "startup", name: "Startup" },
};

const VALUES = {
  title: " Frontend Engineer ",
  description: "Build the product UI with React and TypeScript.",
  location: ["bengaluru"],
  job_type: "Fulltime" as const,
  salary_currency: "₹",
  min_salary: 1500000,
  max_salary: 2500000,
  min_experience: 2,
  max_experience: 5,
  visa_sponsorship: "Not Required" as const,
  min_equity: 0,
  max_equity: 0,
  questions: ["Why us?", ""],
};

const NEW_JOB_ID = "d0000000-0000-4000-8000-0000000000ff";

/** COMPANY_A's existing posting, and one owned by COMPANY_B. */
const OWN = jobPostingOf(COMPANY_A);
const OTHERS = jobPostingOf(COMPANY_B);

let rls: SupabaseMock;
let service: SupabaseMock;
let fetchMock: ReturnType<typeof vi.fn>;
let state: {
  savedStatus: "active" | "inactive";
  allJobsUpdateError: unknown;
};

const methods = (call: RecordedCall) => call.chain.map((c) => c.method);
const has = (call: RecordedCall, method: string) => methods(call).includes(method);
const argsOf = (call: RecordedCall, method: string) =>
  call.chain.find((c) => c.method === method)?.args;
const eqs = (call: RecordedCall) =>
  call.chain.filter((c) => c.method === "eq").map((c) => c.args);

/** The posting row a write returns: the written payload over the existing row. */
function writtenPosting(call: RecordedCall) {
  const payload = (argsOf(call, "insert") ?? argsOf(call, "upsert") ?? argsOf(call, "update"))?.[0] as object;
  const base = has(call, "update")
    ? OWN
    : { ...OWN, id: "b0000000-0000-4000-8000-0000000000aa", job_id: null };
  return {
    ...base,
    ...payload,
    status: state.savedStatus,
    company_info: { id: COMPANY_A.id, name: COMPANY_A.info.name, website: COMPANY_A.info.website },
  };
}

/** Routes each awaited query by its chain, so the tests don't depend on query order. */
function route(mock: SupabaseMock) {
  for (let i = 0; i < 20; i++) {
    mock.queue("company_info", (call) => {
      if (has(call, "update")) return { data: null, error: null };
      return { data: COMPANY_A.infoWithTier, error: null };
    });
    mock.queue("job_postings", (call) => {
      if (has(call, "insert") || has(call, "upsert") || (has(call, "update") && has(call, "select"))) {
        return { data: writtenPosting(call), error: null };
      }
      if (has(call, "update")) return { data: null, error: null };
      // A lookup: only rows matching every eq filter are found.
      const row = [OWN, OTHERS].find((p) =>
        eqs(call).every(([col, value]) => (p as Record<string, unknown>)[col as string] === value),
      );
      return { data: row ?? null, error: null };
    });
    mock.queue("all_jobs", (call) => {
      if (has(call, "insert")) return { data: { id: NEW_JOB_ID }, error: null };
      return { data: null, error: state.allJobsUpdateError };
    });
  }
}

/** Every recorded write, across both clients. */
const writes = (table: string) =>
  [...rls.callsFor(table), ...service.callsFor(table)].filter((c) =>
    ["insert", "upsert", "update", "delete"].some((m) => has(c, m)),
  );

beforeEach(async () => {
  vi.clearAllMocks();
  state = { savedStatus: "inactive", allJobsUpdateError: null };
  rls = createSupabaseMock({ user: COMPANY_A.user });
  service = createSupabaseMock();
  route(rls);
  route(service);
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  await setRequestUser(COMPANY_A.user, rls.client);
  fetchMock = vi.fn().mockResolvedValue(Response.json({ data: "[0.1,0.2]" }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("upsertJobPostingAction: behaviour that must survive", () => {
  it("refuses a new posting at the plan's active job post limit (BL-TEST-006)", async () => {
    vi.mocked(assertLimit).mockRejectedValue(new EntitlementError(AT_LIMIT));

    const result = await upsertJobPostingAction({ values: VALUES });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({ code: "entitlement", key: "active_job_posts", used: 2, amount: 2 }),
    });
    expect(writes("job_postings")).toHaveLength(0);
    expect(writes("all_jobs")).toHaveLength(0);
  });

  it("creates the posting when the limit allows it", async () => {
    expect(await upsertJobPostingAction({ values: VALUES })).toEqual({ success: true, isUpdate: false });
  });

  it("creates the posting, then the all_jobs row, and links job_id", async () => {
    expect(await upsertJobPostingAction({ values: VALUES })).toEqual({ success: true, isUpdate: false });

    const [insertAllJobs] = writes("all_jobs");
    expect(argsOf(insertAllJobs, "insert")?.[0]).toMatchObject({
      job_name: "Frontend Engineer",
      company_name: COMPANY_A.info.name,
      company_url: `/companies/${COMPANY_A.id}`,
      platform: "gethired",
      status: "inactive",
      is_platform_job: true,
    });
    const link = writes("job_postings").find((c) => (argsOf(c, "update")?.[0] as object & { job_id?: string })?.job_id);
    expect(argsOf(link!, "update")?.[0]).toEqual({ job_id: NEW_JOB_ID });
  });

  it("re-embeds an edit, updates all_jobs and revalidates the job", async () => {
    const result = await upsertJobPostingAction({ values: VALUES, existingPostingId: OWN.id });

    expect(result).toEqual({ success: true, isUpdate: true });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/update-embedding/gemini/job"),
      expect.objectContaining({ headers: { "X-Internal-Secret": INTERNAL_API_SECRET } }),
    );
    const [update] = writes("all_jobs");
    expect(argsOf(update, "update")?.[0]).toMatchObject({
      job_name: "Frontend Engineer",
      embedding_new: "[0.1,0.2]",
    });
    expect(eqs(update)).toEqual([["id", OWN.job_id]]);
    expect(revalidateTag).toHaveBeenCalledWith(`job-${OWN.job_id}`);
  });

  it("returns the embedding route's error", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Embedding failed" }, { status: 500 }));

    expect(await upsertJobPostingAction({ values: VALUES, existingPostingId: OWN.id })).toEqual({
      success: false,
      error: "Embedding failed",
    });
  });

  it("asks for a relevance update when the saved posting is active", async () => {
    state.savedStatus = "active";

    await upsertJobPostingAction({ values: VALUES, existingPostingId: OWN.id });

    expect(triggerJobPostingRelevanceUpdate).toHaveBeenCalledWith(OWN.id);
  });
});

describe("upsertJobPostingAction: access control (RS-TEST-001)", () => {
  it("refuses an unauthenticated caller without touching the database", async () => {
    await setRequestUser(null, rls.client);

    expect(await upsertJobPostingAction({ values: VALUES })).toMatchObject({ success: false });
    expect(rls.calls).toHaveLength(0);
    expect(service.calls).toHaveLength(0);
  });

  it("refuses an applicant", async () => {
    await setRequestUser(mockUser({ type: "applicant" }), rls.client);

    expect(await upsertJobPostingAction({ values: VALUES })).toMatchObject({ success: false });
    expect(writes("job_postings")).toHaveLength(0);
  });

  it("treats another company's posting as not found and writes nothing", async () => {
    const result = await upsertJobPostingAction({ values: VALUES, existingPostingId: OTHERS.id });

    expect(result).toEqual({ success: false, error: "Job posting not found." });
    expect(writes("job_postings")).toHaveLength(0);
    expect(writes("all_jobs")).toHaveLength(0);
  });

  it("rejects a company_id smuggled into values", async () => {
    const values = { ...VALUES, company_id: COMPANY_B.id };

    const result = await upsertJobPostingAction({ values } as never);

    expect(result).toMatchObject({ success: false });
    expect(writes("job_postings")).toHaveLength(0);
  });

  it("ignores client-sent job ids: the all_jobs row comes from the database", async () => {
    await upsertJobPostingAction({
      values: VALUES,
      existingPostingId: OWN.id,
      existingJobId: OTHERS.job_id,
    } as never);

    const [update] = writes("all_jobs");
    expect(eqs(update)).toEqual([["id", OWN.job_id]]);
  });

  it("always writes the session company's id", async () => {
    await upsertJobPostingAction({ values: VALUES, companyId: COMPANY_B.id } as never);

    const [insert] = writes("job_postings").filter((c) => has(c, "insert") || has(c, "upsert"));
    const payload = (argsOf(insert, "insert") ?? argsOf(insert, "upsert"))?.[0];
    expect(payload).toMatchObject({ company_id: COMPANY_A.id });
  });

  it("checks the session company's limit and no longer counts posts created", async () => {
    await upsertJobPostingAction({ values: VALUES, companyId: COMPANY_B.id } as never);

    expect(assertLimit).toHaveBeenCalledWith(COMPANY_A.id, "active_job_posts");
    expect(assertLimit).not.toHaveBeenCalledWith(COMPANY_B.id, expect.anything());
    expect(writes("company_info")).toHaveLength(0);
  });

  it("lets a company edit a posting even at the limit", async () => {
    vi.mocked(assertLimit).mockRejectedValue(new EntitlementError(AT_LIMIT));

    expect(await upsertJobPostingAction({ values: VALUES, existingPostingId: OWN.id })).toEqual({
      success: true,
      isUpdate: true,
    });
    expect(assertLimit).not.toHaveBeenCalled();
  });
});
