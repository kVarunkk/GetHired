import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateTag } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, COMPANY_B, jobPostingOf } from "@/test/utils/recruiter";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { triggerJobPostingRelevanceUpdate } from "./relevant-profiles-update";
import { upsertJobPostingAction } from "./upsert-job-posting";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("./relevant-profiles-update", () => ({ triggerJobPostingRelevanceUpdate: vi.fn() }));

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
  postsCreated: number;
  allowedPosts: number | null;
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
      const select = String(argsOf(call, "select")?.[0] ?? "");
      if (select.includes("job_posts_created")) {
        return {
          data: { job_posts_created: state.postsCreated, company_tiers: { allowed_job_posts: state.allowedPosts } },
          error: null,
        };
      }
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
  state = { postsCreated: 0, allowedPosts: 2, savedStatus: "inactive", allJobsUpdateError: null };
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
  it("refuses a new posting once the tier's job post limit is reached", async () => {
    state.postsCreated = 2;

    const result = await upsertJobPostingAction({ values: VALUES });

    expect(result).toEqual({ success: false, error: expect.stringContaining("2 job posts") });
    expect(writes("job_postings")).toHaveLength(0);
  });

  it("has no limit when the tier allows unlimited posts", async () => {
    state.postsCreated = 500;
    state.allowedPosts = null;

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

  it("checks the tier limit of the session company and counts the new post there", async () => {
    await upsertJobPostingAction({ values: VALUES, companyId: COMPANY_B.id } as never);

    const tierRead = [...rls.callsFor("company_info"), ...service.callsFor("company_info")].find((c) =>
      String(argsOf(c, "select")?.[0]).includes("job_posts_created"),
    );
    expect(eqs(tierRead!)).toEqual([["id", COMPANY_A.id]]);
    const [counter] = writes("company_info");
    expect(argsOf(counter, "update")?.[0]).toEqual({ job_posts_created: 1 });
    expect(eqs(counter)).toEqual([["id", COMPANY_A.id]]);
  });

  it("lets a company edit a posting even at the tier limit", async () => {
    state.postsCreated = 2;

    expect(await upsertJobPostingAction({ values: VALUES, existingPostingId: OWN.id })).toEqual({
      success: true,
      isUpdate: true,
    });
  });
});
