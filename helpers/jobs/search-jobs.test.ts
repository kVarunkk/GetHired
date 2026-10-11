import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseJobSearchParams, searchJobs } from "./search-jobs";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { buildQuery } from "@/helpers/jobs/filterQueryBuilder";
import { rerankJobsIfApplicable } from "@/helpers/jobs/ai-rerank-jobs";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/jobs/filterQueryBuilder", () => ({ buildQuery: vi.fn() }));
vi.mock("@/helpers/jobs/ai-rerank-jobs", () => ({ rerankJobsIfApplicable: vi.fn() }));

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
  vi.mocked(buildQuery).mockResolvedValue({
    data: [{ id: "j1" }],
    error: null,
    nextCursor: null,
    count: 1,
    matchedJobIds: [],
  } as never);
  vi.mocked(rerankJobsIfApplicable).mockResolvedValue({
    initialJobs: [{ id: "j1" }],
    totalCount: 1,
  } as never);
});

describe("parseJobSearchParams", () => {
  it("returns defaults for empty params", () => {
    expect(parseJobSearchParams(new URLSearchParams(), { isInternalCall: false })).toEqual({
      jobType: null,
      location: null,
      visaRequirement: null,
      minSalary: null,
      minExperience: null,
      platform: null,
      companyName: null,
      sortBy: "created_at",
      sortOrder: "desc",
      jobTitleKeywords: null,
      tab: null,
      applicationStatus: null,
      createdAfterDays: null,
      applicantUserId: null,
      jobId: null,
      cursor: null,
      limit: 20,
      digestType: null,
      isInternalCall: false,
    });
  });

  it("reads every supported param", () => {
    const params = parseJobSearchParams(
      new URLSearchParams({
        jobType: "Intern",
        location: "Remote",
        visaRequirement: "Required",
        minSalary: "1",
        minExperience: "2",
        platform: "lever",
        companyName: "Acme",
        sortBy: "relevance",
        sortOrder: "asc",
        jobTitleKeywords: "go",
        tab: "applied",
        applicationStatus: "selected",
        createdAfter: "14",
        userId: "u9",
        jobId: "j9",
        cursor: "c9",
        limit: "5",
        type: "digest",
      }),
      { isInternalCall: true },
    );

    expect(params).toMatchObject({
      jobType: "Intern",
      tab: "applied",
      createdAfterDays: "14",
      applicantUserId: "u9",
      jobId: "j9",
      limit: 5,
      digestType: "digest",
      isInternalCall: true,
    });
  });

  it("ignores unknown tab values", () => {
    const params = parseJobSearchParams(new URLSearchParams({ tab: "other" }), {
      isInternalCall: false,
    });

    expect(params.tab).toBeNull();
  });
});

describe("searchJobs", () => {
  it("fills defaults for a partial input", async () => {
    const result = await searchJobs(supabase.client, { location: "Remote", limit: 10 });

    expect(result).toEqual({ ok: true, data: [{ id: "j1" }], totalCount: 1, nextCursor: null });
    expect(buildQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        location: "Remote",
        limit: 10,
        sortBy: "created_at",
        sortOrder: "desc",
        isFavoriteTabActive: false,
        isAppliedJobsTabActive: false,
        isInternalCall: false,
        relevanceSearchType: null,
      }),
    );
  });

  it("returns a typed failure instead of throwing for expected errors", async () => {
    await setRequestUser(null);

    const result = await searchJobs(supabase.client, { sortBy: "relevance" });

    expect(result).toEqual({ ok: false, status: 401, error: "User not found." });
  });

  it("records the failing stage and distinct id in the trace", async () => {
    await setRequestUser(mockUser({ id: "u1" }));
    supabase.queue("user_info", { data: null, error: { code: "57014", message: "timeout" } });
    const trace = { stage: "initialize", distinctId: "unknown" };

    await expect(searchJobs(supabase.client, { sortBy: "relevance" }, trace)).rejects.toEqual({
      code: "57014",
      message: "timeout",
    });
    expect(trace).toEqual({ stage: "fetch_user_embedding_and_credits", distinctId: "u1" });
  });
});
