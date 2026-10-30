import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { rerankJobsForUser, rerankSimilarJobs } from "@/helpers/jobs/rerank-jobs";
import { reportError } from "@/helpers/posthog/report-error";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import type { AllJobWithRelations } from "@/utils/types";
import { rerankJobsIfApplicable } from "./ai-rerank-jobs";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/helpers/jobs/rerank-jobs", () => ({
  rerankJobsForUser: vi.fn(),
  rerankSimilarJobs: vi.fn(),
}));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const job = (id: string) =>
  ({
    id,
    job_name: `Job ${id}`,
    description: "x".repeat(500),
    visa_requirement: null,
    salary_range: null,
    locations: ["Remote"],
    experience: null,
    job_url: "https://masked",
  }) as unknown as AllJobWithRelations;

const JOBS = [job("j1"), job("j2"), job("j3")];

let supabase: SupabaseMock;
const fetchSpy = vi.fn();

const run = (overrides: Partial<Parameters<typeof rerankJobsIfApplicable>[1]> = {}) =>
  rerankJobsIfApplicable(supabase.client, {
    initialJobs: JOBS,
    initialCount: 3,
    userId: "u1",
    jobId: null,
    aiCredits: 10,
    matchedJobIds: ["j1", "j2", "j3"],
    relevanceSearchType: "job_digest",
    cursor: null,
    ...overrides,
  });

beforeEach(() => {
  supabase = createSupabaseMock();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rerankJobsIfApplicable", () => {
  it("re-ranks in-process with the caller's client, never over HTTP", async () => {
    vi.mocked(rerankJobsForUser).mockResolvedValue({
      rerankedJobs: ["j3", "j1"],
      filteredOutJobs: ["j2"],
    });

    const result = await run();

    expect(result.initialJobs.map((j) => j.id)).toEqual(["j3", "j1"]);
    expect(result.totalCount).toBe(2);
    expect(rerankJobsForUser).toHaveBeenCalledWith(supabase.client, {
      userId: "u1",
      type: "job_digest",
      jobs: JOBS.map((j) => ({
        id: j.id,
        job_name: j.job_name,
        description: "x".repeat(400),
        visa_requirement: null,
        salary_range: null,
        locations: ["Remote"],
        experience: null,
      })),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(headers).not.toHaveBeenCalled();
  });

  it("keeps the reasons on a digest with suggestions", async () => {
    vi.mocked(rerankJobsForUser).mockResolvedValue({
      rerankedJobs: [{ id: "j2", reason: "Because." }],
      filteredOutJobs: [],
    });

    const result = await run({ relevanceSearchType: "job_digest_with_suggestions" });

    expect(result.initialJobs).toEqual([{ ...JOBS[1], match_reason: "Because." }]);
    expect(result.totalCount).toBe(1);
  });

  it("re-ranks similar jobs against the source job", async () => {
    vi.mocked(rerankSimilarJobs).mockResolvedValue({
      rerankedJobs: ["j2"],
      filteredOutJobs: [],
    });

    const result = await run({ relevanceSearchType: "similar_jobs", jobId: "ref" });

    expect(rerankSimilarJobs).toHaveBeenCalledWith(
      supabase.client,
      expect.objectContaining({ userId: "u1", jobId: "ref" }),
    );
    expect(result.initialJobs.map((j) => j.id)).toEqual(["j2"]);
  });

  it.each([
    ["a later page", { cursor: "c" }],
    ["too few credits", { aiCredits: 4 }],
    ["a standard search", { relevanceSearchType: "standard" as const }],
    ["no relevance search", { relevanceSearchType: null }],
    ["similar jobs without a source job", { relevanceSearchType: "similar_jobs" as const }],
  ])("skips the re-rank for %s, keeping the vector order", async (_, overrides) => {
    const result = await run({ ...overrides, matchedJobIds: ["j3", "j1", "j2"] });

    expect(result.initialJobs.map((j) => j.id)).toEqual(["j3", "j1", "j2"]);
    expect(rerankJobsForUser).not.toHaveBeenCalled();
    expect(rerankSimilarJobs).not.toHaveBeenCalled();
  });

  it("keeps the vector order when the profile is missing", async () => {
    vi.mocked(rerankJobsForUser).mockResolvedValue(null);

    const result = await run();

    expect(result.initialJobs.map((j) => j.id)).toEqual(["j1", "j2", "j3"]);
  });

  it("reports a failure and keeps the vector order", async () => {
    vi.mocked(rerankJobsForUser).mockRejectedValue(new Error("jev down"));

    const result = await run();

    expect(result.initialJobs.map((j) => j.id)).toEqual(["j1", "j2", "j3"]);
    expect(reportError).toHaveBeenCalled();
  });
});
