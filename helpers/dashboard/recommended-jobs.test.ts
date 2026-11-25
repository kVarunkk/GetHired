import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { loadRecommendedJobs, type RelevanceProfile } from "./recommended-jobs";

const USER = "00000000-0000-4000-8000-000000000001";
const done: RelevanceProfile = {
  filled: true,
  relevant_jobs_update_status: "completed",
  relevance_started_at: null,
  updated_at: "2026-11-01T00:00:00Z",
};

const row = (id: string, rank: number) => ({
  relevance_rank: rank,
  all_jobs: { id, job_name: ` Job ${id} `, company_name: null, locations: ["Remote", "Pune"], status: "active" },
});

function setup(response: { data: unknown; error: unknown }) {
  const mock = createSupabaseMock({ user: { id: USER } });
  mock.queue("user_relevant_jobs", response);
  return { mock, ctx: { supabase: mock.client, user: { id: USER } } };
}

describe("loadRecommendedJobs", () => {
  it("reads the user's active matches best first and leaves out excluded jobs", async () => {
    const { mock, ctx } = setup({ data: [row("a", 1), row("b", 2), row("c", 3)], error: null });

    const result = await loadRecommendedJobs(ctx, { profile: done, exclude: new Set(["b"]), limit: 5 });

    expect(result).toEqual({
      state: "ready",
      jobs: [
        { id: "a", jobTitle: "Job a", companyName: "Unknown company", location: "Remote" },
        { id: "c", jobTitle: "Job c", companyName: "Unknown company", location: "Remote" },
      ],
    });
    const chain = mock.callsFor("user_relevant_jobs")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", USER] });
    expect(chain).toContainEqual({ method: "eq", args: ["all_jobs.status", "active"] });
    expect(chain).toContainEqual({ method: "order", args: ["relevance_rank", { ascending: true }] });
  });

  it("stops at the limit", async () => {
    const { ctx } = setup({ data: [row("a", 1), row("b", 2), row("c", 3)], error: null });
    const result = await loadRecommendedJobs(ctx, { profile: done, exclude: new Set(), limit: 2 });
    expect(result.state === "ready" && result.jobs.map((job) => job.id)).toEqual(["a", "b"]);
  });

  it("has no feed before onboarding, and doesn't query", async () => {
    const { mock, ctx } = setup({ data: [], error: null });
    expect(await loadRecommendedJobs(ctx, { profile: { ...done, filled: false }, exclude: new Set() })).toEqual({
      state: "no_profile",
    });
    expect(mock.callsFor("user_relevant_jobs")).toHaveLength(0);
  });

  it.each([
    ["pending", "not_run"],
    ["failed", "failed"],
    ["completed", "ready"],
  ] as const)("reads an empty feed with status %s as %s", async (status, state) => {
    const { ctx } = setup({ data: [], error: null });
    const result = await loadRecommendedJobs(ctx, {
      profile: { ...done, relevant_jobs_update_status: status },
      exclude: new Set(),
    });
    expect(result.state).toBe(state);
  });

  it("reads an empty feed with a run under way as processing", async () => {
    const { ctx } = setup({ data: [], error: null });
    const result = await loadRecommendedJobs(ctx, {
      profile: { ...done, relevant_jobs_update_status: "progress", relevance_started_at: new Date().toISOString() },
      exclude: new Set(),
    });
    expect(result.state).toBe("processing");
  });

  it("throws a read error", async () => {
    const { ctx } = setup({ data: null, error: new Error("boom") });
    await expect(loadRecommendedJobs(ctx, { profile: done, exclude: new Set() })).rejects.toThrow("boom");
  });
});
