import { beforeEach, describe, expect, it, vi } from "vitest";
import { startReviewAnalysis } from "./start-review-analysis";
import { flushAfter } from "@/test/utils/after";
import { mockGenerateModel } from "@/test/utils/ai";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { google } from "@ai-sdk/google";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { updateReviewAnalysisStatus } from "@/helpers/resume-review/update-review-analysis";

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
  vi.clearAllMocks();
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

  describe("saving the analysis (RE-REQ-054, RE-REQ-054a)", () => {
    const CONTENT = {
      version: 2,
      sections: [
        {
          id: "s1",
          type: "experience",
          items: [{ id: "i1", bullets: [{ id: "b1", text: "Worked on the billing API" }] }],
        },
      ],
    };

    const suggestion = (bullet_id: string, original: string) => ({
      bullet_id,
      section: "Experience",
      original,
      suggested: "Cut billing errors by [X%]",
      reason: "No proof of impact",
      priority: "high",
    });

    const run = async (bulletPoints: unknown[]) => {
      supabase.queue("user_info", { data: { ai_credits: 5, email: "a@b.c" }, error: null });
      supabase.queue("resume_reviews", {
        data: {
          name: "r",
          resume_id: "r1",
          resumes: { content: CONTENT, revision: 7 },
          target_jd: "Frontend role",
        },
        error: null,
      });
      const model = mockGenerateModel(
        JSON.stringify({ ...ANALYSIS, bullet_points: bulletPoints }),
      );
      await startReviewAnalysis(supabase.client, "u1", "rev1", { model });
      await flushAfter();
      return model;
    };

    const savedReview = () =>
      supabase
        .callsFor("resume_reviews")
        .flatMap((call) => call.chain)
        .filter((step) => step.method === "update")
        .map((step) => step.args[0] as Record<string, unknown>)
        .find((update) => update.status === "completed")!;

    it("asks for placeholders and never for an estimate", async () => {
      const model = await run([]);
      const prompt = JSON.stringify(model.doGenerateCalls[0].prompt);

      expect(prompt).not.toMatch(/conservative estimate/i);
      expect(prompt).toMatch(/never invent a number, name or fact/i);
      expect(prompt).toContain("[X%]");
      expect(prompt).toContain("[number of users]");
    });

    it("replaces the model's original with the bullet's real text", async () => {
      await run([suggestion("b1", "Worked on billing")]);

      const saved = savedReview().ai_response as { bullet_points: { original: string }[] };
      expect(saved.bullet_points[0].original).toBe("Worked on the billing API");
    });

    it("drops suggestions for bullets that don't exist, and repeats of one bullet", async () => {
      await run([
        suggestion("b1", "x"),
        suggestion("made-up", "y"),
        { ...suggestion("b1", "x"), suggested: "A second rewrite" },
      ]);

      const saved = savedReview().ai_response as { bullet_points: { bullet_id: string; suggested: string }[] };
      expect(saved.bullet_points.map((bp) => bp.bullet_id)).toEqual(["b1"]);
      expect(saved.bullet_points[0].suggested).toBe("Cut billing errors by [X%]");
    });

    it("stores the revision the analysis read", async () => {
      await run([]);

      expect(savedReview().resume_revision).toBe(7);
    });

    it("clears what was applied from the previous analysis", async () => {
      await run([]);

      const removed = supabase.callsFor("resume_review_applied")[0];
      expect(removed.chain).toContainEqual({ method: "delete", args: [] });
      expect(removed.chain).toContainEqual({ method: "eq", args: ["review_id", "rev1"] });
    });

    it("charges only after the analysis is saved", async () => {
      await run([]);

      expect(deductUserCreditsHelper).toHaveBeenCalledTimes(1);
    });

    it("charges nothing when the model fails", async () => {
      supabase.queue("user_info", { data: { ai_credits: 5, email: "a@b.c" }, error: null });
      supabase.queue("resume_reviews", {
        data: { name: "r", resume_id: "r1", resumes: { content: CONTENT, revision: 7 }, target_jd: "Role" },
        error: null,
      });

      await startReviewAnalysis(supabase.client, "u1", "rev1", { model: mockGenerateModel("not json") });
      await flushAfter();

      expect(deductUserCreditsHelper).not.toHaveBeenCalled();
      expect(updateReviewAnalysisStatus).toHaveBeenCalledWith(supabase.client, true, "rev1", "failed");
    });
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
