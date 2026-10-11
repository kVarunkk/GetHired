import { beforeEach, describe, expect, it, vi } from "vitest";
import { startReviewAnalysis } from "./start-review-analysis";
import { flushAfter } from "@/test/utils/after";
import { mockGenerateModel } from "@/test/utils/ai";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { google } from "@ai-sdk/google";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";

vi.mock("@ai-sdk/google", () => ({ google: vi.fn() }));
vi.mock("@/helpers/ai/deduct-user-credits", () => ({ deductUserCreditsHelper: vi.fn() }));
vi.mock("@/app/actions/send-review-status-email", () => ({
  sendResumeReviewStatusEmail: vi.fn(),
}));
vi.mock("@/helpers/resume-review/update-review-analysis", () => ({
  updateReviewAnalysisStatus: vi.fn(),
}));

const ANALYSIS = { overall_feedback: "ok", score: 80, bullet_points: [] };

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
});

describe("startReviewAnalysis", () => {
  it("starts the analysis with an injected model", async () => {
    supabase.queue("user_info", { data: { ai_credits: 5, email: "a@b.c" }, error: null });
    supabase.queue("resume_reviews", {
      data: { name: "r", resume_id: "r1", resumes: { content: {} }, target_jd: "Frontend role" },
      error: null,
    });
    const model = mockGenerateModel(JSON.stringify(ANALYSIS));

    const result = await startReviewAnalysis(supabase.client, "u1", "rev1", { model });
    await flushAfter();

    expect(result).toEqual({ ok: true });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(google).not.toHaveBeenCalled();
    expect(deductUserCreditsHelper).toHaveBeenCalledWith(supabase.client, "u1", 5);
  });

  it("returns typed failures instead of throwing", async () => {
    supabase.queue("user_info", { data: { ai_credits: 10, email: "a@b.c" }, error: null });
    supabase.queue("resume_reviews", { data: null, error: null });

    expect(await startReviewAnalysis(supabase.client, "u1", "missing")).toEqual({
      ok: false,
      status: 500,
      error: "Job Description not found",
    });
  });

  it("returns 402 below the credit threshold without touching the review", async () => {
    supabase.queue("user_info", { data: { ai_credits: 0, email: "a@b.c" }, error: null });

    expect(await startReviewAnalysis(supabase.client, "u1", "rev1")).toEqual({
      ok: false,
      status: 402,
      error: "Insufficient AI credits. Please top up to continue.",
    });
    expect(supabase.callsFor("resume_reviews")).toHaveLength(0);
  });
});
