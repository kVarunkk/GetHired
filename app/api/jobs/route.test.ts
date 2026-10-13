/**
 * Characterisation tests for GET /api/jobs (TASK-020).
 * They pin the route's current behaviour so the extraction into
 * helpers/jobs/search-jobs.ts can be checked for regressions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { buildRequest } from "@/test/utils/request";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { buildQuery } from "@/helpers/jobs/filterQueryBuilder";
import { rerankJobsIfApplicable } from "@/helpers/jobs/ai-rerank-jobs";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/jobs/filterQueryBuilder", () => ({ buildQuery: vi.fn() }));
vi.mock("@/helpers/jobs/ai-rerank-jobs", () => ({ rerankJobsIfApplicable: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const JOBS = [{ id: "j1" }, { id: "j2" }];
const RERANKED = [{ id: "j2" }, { id: "j1" }];

const DEFAULT_QUERY_ARGS = {
  jobType: null,
  location: null,
  visaRequirement: null,
  minSalary: null,
  minExperience: null,
  platform: null,
  companyName: null,
  cursor: null,
  limit: 20,
  sortBy: "created_at",
  sortOrder: "desc",
  jobTitleKeywords: null,
  isFavoriteTabActive: false,
  isAppliedJobsTabActive: false,
  userEmbedding: null,
  applicationStatus: null,
  createdAfter: null,
  isInternalCall: false,
  jobEmbedding: null,
  relevanceSearchType: null,
  userId: null,
};

let supabase: SupabaseMock;
let serviceSupabase: SupabaseMock;

const get = (searchParams: Record<string, string> = {}, headers?: Record<string, string>) =>
  GET(buildRequest("/api/jobs", { searchParams, headers }));

beforeEach(() => {
  vi.stubEnv("INTERNAL_API_SECRET", "internal-secret");
  supabase = createSupabaseMock();
  serviceSupabase = createSupabaseMock();
  vi.mocked(createClient).mockResolvedValue(supabase.client);
  vi.mocked(createServiceRoleClient).mockReturnValue(serviceSupabase.client);
  vi.mocked(buildQuery).mockResolvedValue({
    data: JOBS,
    error: null,
    nextCursor: "cursor-2",
    count: 42,
    matchedJobIds: ["j1", "j2"],
  } as never);
  vi.mocked(rerankJobsIfApplicable).mockResolvedValue({
    initialJobs: RERANKED,
    totalCount: 40,
  } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GET /api/jobs: listing and filters", () => {
  it("lists jobs with default params through the request-scoped client", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: RERANKED,
      totalCount: 40,
      nextCursor: "cursor-2",
    });
    expect(buildQuery).toHaveBeenCalledWith(DEFAULT_QUERY_ARGS);
    expect(rerankJobsIfApplicable).toHaveBeenCalledWith({
      initialJobs: JOBS,
      initialCount: 42,
      userId: undefined,
      jobId: null,
      aiCredits: 0,
      matchedJobIds: ["j1", "j2"],
      relevanceSearchType: null,
      cursor: null,
      isInternalCall: false,
    });
    expect(createClient).toHaveBeenCalled();
    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(getUserFromRequest).not.toHaveBeenCalled();
    expect(supabase.calls).toEqual([]);
  });

  it("passes every filter param through to buildQuery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T10:00:00.000Z"));

    await get({
      jobType: "Fulltime|Contract",
      location: "Remote|India",
      visaRequirement: "Will Sponsor",
      minSalary: "100000",
      minExperience: "3",
      platform: "ycombinator",
      companyName: "Acme",
      sortBy: "salary_max",
      sortOrder: "asc",
      jobTitleKeywords: "react|frontend",
      createdAfter: "7",
      cursor: "abc",
      limit: "10",
    });

    expect(buildQuery).toHaveBeenCalledWith({
      ...DEFAULT_QUERY_ARGS,
      jobType: "Fulltime|Contract",
      location: "Remote|India",
      visaRequirement: "Will Sponsor",
      minSalary: "100000",
      minExperience: "3",
      platform: "ycombinator",
      companyName: "Acme",
      sortBy: "salary_max",
      sortOrder: "asc",
      jobTitleKeywords: "react|frontend",
      createdAfter: "2026-10-04T00:00:00.000Z",
      cursor: "abc",
      limit: 10,
    });
  });

  it("maps tab=saved to isFavoriteTabActive", async () => {
    await get({ tab: "saved" });

    expect(buildQuery).toHaveBeenCalledWith(
      expect.objectContaining({ isFavoriteTabActive: true, isAppliedJobsTabActive: false }),
    );
  });

  it("maps tab=applied and applicationStatus", async () => {
    await get({ tab: "applied", applicationStatus: "reviewed|selected" });

    expect(buildQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        isFavoriteTabActive: false,
        isAppliedJobsTabActive: true,
        applicationStatus: "reviewed|selected",
      }),
    );
  });

  it("uses the service-role client for internal calls", async () => {
    await get({}, { "X-Internal-Secret": "internal-secret" });

    expect(createServiceRoleClient).toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(buildQuery).toHaveBeenCalledWith(
      expect.objectContaining({ isInternalCall: true }),
    );
    expect(rerankJobsIfApplicable).toHaveBeenCalledWith(
      expect.objectContaining({ isInternalCall: true }),
    );
  });

  it("treats a wrong internal secret as a normal call", async () => {
    await get({}, { "X-Internal-Secret": "wrong" });

    expect(createClient).toHaveBeenCalled();
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });
});

describe("GET /api/jobs: relevance search", () => {
  it("runs a standard relevance search for the signed-in user", async () => {
    await setRequestUser(mockUser({ id: "u1" }));
    supabase.queue("user_info", {
      data: { embedding_new: "[0.1,0.2]", ai_credits: 10 },
      error: null,
    });

    const res = await get({ sortBy: "relevance" });

    expect(res.status).toBe(200);
    expect(supabase.callsFor("user_info")[0].chain).toEqual([
      { method: "select", args: ["embedding_new, ai_credits"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "single", args: [] },
    ]);
    expect(buildQuery).toHaveBeenCalledWith({
      ...DEFAULT_QUERY_ARGS,
      sortBy: "relevance",
      userEmbedding: "[0.1,0.2]",
      relevanceSearchType: "standard",
    });
    expect(rerankJobsIfApplicable).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        aiCredits: 10,
        relevanceSearchType: "standard",
      }),
    );
  });

  it("returns 402 when a standard relevance search lacks credits", async () => {
    await setRequestUser(mockUser({ id: "u1" }));
    supabase.queue("user_info", {
      data: { embedding_new: "[0.1]", ai_credits: 4 },
      error: null,
    });

    const res = await get({ sortBy: "relevance" });

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: "Insufficient AI credits. Please navigate to dashboard to top up.",
    });
    expect(buildQuery).not.toHaveBeenCalled();
  });

  it("returns 401 for a relevance search without a user", async () => {
    await setRequestUser(null);

    const res = await get({ sortBy: "relevance" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "User not found." });
    expect(buildQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when the user's profile is missing", async () => {
    await setRequestUser(mockUser({ id: "u1" }));
    supabase.queue("user_info", {
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    });

    const res = await get({ sortBy: "relevance" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User profile not found." });
  });

  it("finds similar jobs using the job's embedding", async () => {
    await setRequestUser(mockUser({ id: "u1" }));
    supabase.queue("all_jobs", { data: { embedding_new: "[0.9]" }, error: null });
    supabase.queue("user_info", {
      data: { embedding_new: "[0.1]", ai_credits: 0 },
      error: null,
    });

    const res = await get({ sortBy: "relevance", jobId: "job-1" });

    expect(res.status).toBe(200);
    expect(supabase.callsFor("all_jobs")[0].chain).toEqual([
      { method: "select", args: ["embedding_new"] },
      { method: "eq", args: ["id", "job-1"] },
      { method: "single", args: [] },
    ]);
    expect(buildQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        jobEmbedding: "[0.9]",
        userEmbedding: "[0.1]",
        relevanceSearchType: "similar_jobs",
      }),
    );
    expect(rerankJobsIfApplicable).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "job-1", relevanceSearchType: "similar_jobs" }),
    );
  });

  it("returns 404 when the similar-jobs source job is missing", async () => {
    await setRequestUser(mockUser({ id: "u1" }));
    supabase.queue("all_jobs", {
      data: null,
      error: { code: "PGRST116", message: "no rows" },
    });

    const res = await get({ sortBy: "relevance", jobId: "missing" });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "Some error occured. Please try again later.",
    });
    expect(supabase.callsFor("user_info")).toHaveLength(0);
  });

  it("runs a job digest for an explicit userId without authenticating", async () => {
    supabase.queue("user_info", {
      data: { embedding_new: "[0.3]", ai_credits: 1 },
      error: null,
    });

    await get({ sortBy: "relevance", userId: "digest-user" });

    expect(getUserFromRequest).not.toHaveBeenCalled();
    expect(supabase.callsFor("user_info")[0].chain[1]).toEqual({
      method: "eq",
      args: ["user_id", "digest-user"],
    });
    expect(buildQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        relevanceSearchType: "job_digest",
        userId: "digest-user",
        userEmbedding: "[0.3]",
      }),
    );
  });

  it("uses job_digest_with_suggestions for type=digest", async () => {
    supabase.queue("user_info", {
      data: { embedding_new: "[0.3]", ai_credits: 1 },
      error: null,
    });

    await get({ sortBy: "relevance", userId: "digest-user", type: "digest" });

    expect(buildQuery).toHaveBeenCalledWith(
      expect.objectContaining({ relevanceSearchType: "job_digest_with_suggestions" }),
    );
  });
});

describe("GET /api/jobs: errors", () => {
  it("returns 500 and reports the stage when buildQuery fails", async () => {
    vi.mocked(buildQuery).mockResolvedValue({
      data: null,
      error: { message: "query exploded", code: "XX000", details: "d", hint: "h" },
    } as never);

    const res = await get({ createdAfter: "3" });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "query exploded" });
    expect(eventCaptureServerException).toHaveBeenCalledWith({
      error: new Error("query exploded"),
      distinctId: "unknown",
      properties: {
        flow: "jobs_api",
        failure_stage: "build_jobs_query",
        error_message: "query exploded",
        error_name: undefined,
        error_code: "XX000",
        error_details: "d",
        error_hint: "h",
        request_path: "/api/jobs",
        sort_by: "created_at",
        created_after_days: "3",
        internal_call: false,
      },
    });
  });

  it("reports fetch_user_embedding_and_credits for non-404 profile errors", async () => {
    await setRequestUser(mockUser({ id: "u1" }));
    supabase.queue("user_info", {
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });

    const res = await get({ sortBy: "relevance" });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "statement timeout" });
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "u1",
        properties: expect.objectContaining({
          failure_stage: "fetch_user_embedding_and_credits",
          sort_by: "relevance",
        }),
      }),
    );
  });

  it("reports rerank_jobs when reranking throws", async () => {
    vi.mocked(rerankJobsIfApplicable).mockRejectedValue(new Error("rerank down"));

    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "rerank down" });
    expect(eventCaptureServerException).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          failure_stage: "rerank_jobs",
          error_name: "Error",
        }),
      }),
    );
  });
});
