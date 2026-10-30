import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { rerankWithJev } from "@/utils/rerank-jev";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { TAICredits, type AllJobWithRelations } from "@/utils/types";
import { rerankJobsForUser, rerankSimilarJobs } from "./rerank-jobs";

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(),
}));
vi.mock("@ai-sdk/google", () => ({ google: vi.fn(() => "gemini") }));
vi.mock("@/utils/rerank-jev", () => ({ rerankWithJev: vi.fn() }));
vi.mock("@/helpers/ai/deduct-user-credits", () => ({ deductUserCreditsHelper: vi.fn() }));

const JOBS = [
  { id: "j1", job_name: "Frontend", description: "short" },
  { id: "j2", job_name: "Backend", description: "short" },
] as AllJobWithRelations[];

const PROFILE = {
  desired_roles: ["Engineer"],
  experience_years: 3,
  preferred_locations: ["Remote"],
  salary_currency: "$",
  min_salary: 1,
  max_salary: 2,
  top_skills: ["React"],
  company_size_preference: null,
  career_goals_short_term: null,
  career_goals_long_term: null,
  visa_sponsorship_required: false,
  work_style_preferences: null,
  ai_credits: 10,
  job_type: null,
  resumes: [],
};

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
  vi.mocked(deductUserCreditsHelper).mockResolvedValue({ success: true });
});

describe("rerankJobsForUser", () => {
  it("re-ranks against the user's profile with full descriptions and charges once", async () => {
    supabase.queue("all_jobs", {
      data: [
        { id: "j1", description: "full one" },
        { id: "j2", description: "full two" },
      ],
      error: null,
    });
    supabase.queue("user_info", { data: PROFILE, error: null });
    vi.mocked(rerankWithJev).mockResolvedValue({
      reranked_job_ids: ["j2", "j1"],
      filtered_out_ids: ["j3"],
    });

    const result = await rerankJobsForUser(supabase.client, {
      userId: "u1",
      jobs: JOBS,
      type: "job_digest",
    });

    expect(result).toEqual({ rerankedJobs: ["j2", "j1"], filteredOutJobs: ["j3"] });
    expect(supabase.callsFor("user_info")[0].chain).toContainEqual({
      method: "eq",
      args: ["user_id", "u1"],
    });
    expect(vi.mocked(rerankWithJev).mock.calls[0][0]).toMatchObject({
      type: "job_digest",
      reference: { id: "u1", preferences: { desired_roles: ["Engineer"] } },
      items: [
        { id: "j1", description: "full one" },
        { id: "j2", description: "full two" },
      ],
    });
    expect(deductUserCreditsHelper).toHaveBeenCalledExactlyOnceWith(
      supabase.client,
      "u1",
      TAICredits.AI_SEARCH_ASK_AI_RESUME,
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it("adds reasons for the top jobs on a digest with suggestions", async () => {
    supabase.queue("all_jobs", { data: [], error: null });
    supabase.queue("user_info", { data: PROFILE, error: null });
    vi.mocked(rerankWithJev).mockResolvedValue({
      reranked_job_ids: ["j1"],
      filtered_out_ids: [],
    });
    vi.mocked(generateText).mockResolvedValue({
      output: { reranked_jobs: [{ id: "j1", reason: "Your React fits." }] },
    } as never);

    const result = await rerankJobsForUser(supabase.client, {
      userId: "u1",
      jobs: JOBS,
      type: "job_digest_with_suggestions",
    });

    expect(result).toEqual({
      rerankedJobs: [{ id: "j1", reason: "Your React fits." }],
      filteredOutJobs: [],
    });
    expect(deductUserCreditsHelper).toHaveBeenCalledOnce();
  });

  it("returns null without charging when the profile is missing", async () => {
    supabase.queue("all_jobs", { data: [], error: null });
    supabase.queue("user_info", { data: null, error: null });

    const result = await rerankJobsForUser(supabase.client, {
      userId: "u1",
      jobs: JOBS,
      type: "job_digest",
    });

    expect(result).toBeNull();
    expect(rerankWithJev).not.toHaveBeenCalled();
    expect(deductUserCreditsHelper).not.toHaveBeenCalled();
  });

  it("throws database errors without charging", async () => {
    supabase.queue("all_jobs", { data: [], error: null });
    supabase.queue("user_info", { data: null, error: { code: "57014", message: "timeout" } });

    await expect(
      rerankJobsForUser(supabase.client, { userId: "u1", jobs: JOBS, type: "job_digest" }),
    ).rejects.toMatchObject({ code: "57014" });
    expect(deductUserCreditsHelper).not.toHaveBeenCalled();
  });
});

describe("rerankSimilarJobs", () => {
  it("re-ranks against the reference job and charges the user once", async () => {
    supabase.queue("all_jobs", { data: [{ id: "j1", description: "full one" }], error: null });
    supabase.queue("all_jobs", { data: { id: "ref", job_name: "Reference" }, error: null });
    vi.mocked(rerankWithJev).mockResolvedValue({
      reranked_job_ids: ["j1"],
      filtered_out_ids: ["j2"],
    });

    const result = await rerankSimilarJobs(supabase.client, {
      userId: "u1",
      jobId: "ref",
      jobs: JOBS,
    });

    expect(result).toEqual({ rerankedJobs: ["j1"], filteredOutJobs: ["j2"] });
    expect(supabase.callsFor("all_jobs")[1].chain).toContainEqual({
      method: "eq",
      args: ["id", "ref"],
    });
    expect(vi.mocked(rerankWithJev).mock.calls[0][0]).toMatchObject({
      type: "similar_jobs",
      reference: { id: "ref" },
      items: [{ id: "j1", description: "full one" }, { id: "j2", description: "" }],
    });
    expect(deductUserCreditsHelper).toHaveBeenCalledExactlyOnceWith(
      supabase.client,
      "u1",
      TAICredits.AI_SEARCH_ASK_AI_RESUME,
    );
  });
});
