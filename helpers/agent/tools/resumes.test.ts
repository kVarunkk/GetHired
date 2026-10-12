import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResumeTools } from "./resumes";
import { execTool, toolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { setPrimaryResumeAction } from "@/app/actions/set-primary-resume";
import { createResumeReviewAction } from "@/app/actions/create-resume-review";
import { startReviewAnalysis } from "@/helpers/resume-review/start-review-analysis";

vi.mock("@/app/actions/set-primary-resume", () => ({ setPrimaryResumeAction: vi.fn() }));
vi.mock("@/app/actions/create-resume-review", () => ({ createResumeReviewAction: vi.fn() }));
vi.mock("@/helpers/resume-review/start-review-analysis", () => ({ startReviewAnalysis: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const RESUME_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const REVIEW_ID = "33333333-3333-4333-8333-333333333333";
const JD = "We are hiring a senior frontend engineer to build our payments UI in React.";

let supabase: SupabaseMock;
let tools: ReturnType<typeof createResumeTools>;

beforeEach(() => {
  supabase = createSupabaseMock();
  tools = createResumeTools(toolContext(supabase.client));
});

describe("listResumes tool", () => {
  it("lists the user's resumes with a parse status, without their content", async () => {
    supabase.queue("resumes", {
      data: [
        { id: "r1", name: "CV 2026", is_primary: true, parsing_failed: false, content: { a: 1 }, created_at: "c1" },
        { id: "r2", name: null, is_primary: false, parsing_failed: false, content: null, created_at: "c2" },
        { id: "r3", name: "Old", is_primary: false, parsing_failed: true, content: null, created_at: "c3" },
      ],
      error: null,
    });

    const result = await execTool(tools.listResumes, {});

    expect(supabase.callsFor("resumes")[0].chain).toEqual([
      { method: "select", args: ["id, name, is_primary, parsing_failed, content, created_at"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "limit", args: [20] },
    ]);
    expect(result).toEqual({
      resumes: [
        { id: "r1", name: "CV 2026", isPrimary: true, status: "ready", createdAt: "c1" },
        { id: "r2", name: null, isPrimary: false, status: "processing", createdAt: "c2" },
        { id: "r3", name: "Old", isPrimary: false, status: "failed", createdAt: "c3" },
      ],
    });
  });
});

describe("setPrimaryResume tool", () => {
  it("sets the user's own resume as primary", async () => {
    supabase.queue("resumes", { data: { id: RESUME_ID }, error: null });
    vi.mocked(setPrimaryResumeAction).mockResolvedValue({ success: true });

    const result = await execTool(tools.setPrimaryResume, { resumeId: RESUME_ID });

    expect(supabase.callsFor("resumes")[0].chain).toEqual([
      { method: "select", args: ["id"] },
      { method: "eq", args: ["id", RESUME_ID] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(setPrimaryResumeAction).toHaveBeenCalledWith(RESUME_ID);
    expect(result).toEqual({ resumeId: RESUME_ID, isPrimary: true });
  });

  it("refuses resumes the user doesn't own", async () => {
    expect(await execTool(tools.setPrimaryResume, { resumeId: RESUME_ID })).toEqual({
      error: "Resume not found.",
    });
    expect(setPrimaryResumeAction).not.toHaveBeenCalled();
  });

  it("passes action errors through", async () => {
    supabase.queue("resumes", { data: { id: RESUME_ID }, error: null });
    vi.mocked(setPrimaryResumeAction).mockResolvedValue({
      success: false,
      error: "Background Embedding Failed",
    });

    expect(await execTool(tools.setPrimaryResume, { resumeId: RESUME_ID })).toEqual({
      error: "Background Embedding Failed",
    });
  });
});

describe("requestResumeUpload tool", () => {
  it("has no server-side execute", () => {
    expect(tools.requestResumeUpload.execute).toBeUndefined();
  });

  it("accepts an optional reason", async () => {
    expect((await validateInput(tools.requestResumeUpload, {})).success).toBe(true);
    expect(
      (await validateInput(tools.requestResumeUpload, { reason: "To review it" })).success,
    ).toBe(true);
  });
});

describe("startResumeReview tool", () => {
  const parsedResume = { id: RESUME_ID, content: { sections: [] }, parsing_failed: false };

  beforeEach(() => {
    vi.mocked(createResumeReviewAction).mockResolvedValue({ success: true, reviewId: REVIEW_ID });
    vi.mocked(startReviewAnalysis).mockResolvedValue({ ok: true });
  });

  it("creates a review against a job and starts the analysis", async () => {
    supabase.queue("resumes", { data: parsedResume, error: null });

    const result = await execTool(tools.startResumeReview, {
      resumeId: RESUME_ID,
      jobId: JOB_ID,
      name: "Acme review",
    });

    const formData = vi.mocked(createResumeReviewAction).mock.calls[0][0];
    expect(Object.fromEntries(formData.entries())).toEqual({
      existingResumeId: RESUME_ID,
      jobId: JOB_ID,
      name: "Acme review",
    });
    expect(supabase.callsFor("resume_reviews")).toHaveLength(0);
    expect(startReviewAnalysis).toHaveBeenCalledWith(supabase.client, "u1", REVIEW_ID);
    expect(result).toEqual({
      reviewId: REVIEW_ID,
      status: "processing",
      url: `/resume-review/${REVIEW_ID}`,
      message: "The review usually takes about a minute. The user will get an email when it's ready.",
    });
  });

  it("stores a pasted job description on the review before starting", async () => {
    supabase.queue("resumes", { data: parsedResume, error: null });

    await execTool(tools.startResumeReview, { resumeId: RESUME_ID, jobDescription: JD });

    const formData = vi.mocked(createResumeReviewAction).mock.calls[0][0];
    expect(Object.fromEntries(formData.entries())).toEqual({ existingResumeId: RESUME_ID });
    expect(supabase.callsFor("resume_reviews")[0].chain).toEqual([
      { method: "update", args: [{ target_jd: JD }] },
      { method: "eq", args: ["id", REVIEW_ID] },
      { method: "eq", args: ["user_id", "u1"] },
    ]);
    expect(startReviewAnalysis).toHaveBeenCalled();
  });

  it.each([
    ["neither a job nor a description", { resumeId: RESUME_ID }],
    ["both a job and a description", { resumeId: RESUME_ID, jobId: JOB_ID, jobDescription: JD }],
    ["a description that's too short", { resumeId: RESUME_ID, jobDescription: "short" }],
  ])("rejects %s", async (_label, input) => {
    expect((await validateInput(tools.startResumeReview, input)).success).toBe(false);
  });

  it.each([
    ["missing", null, "Resume not found."],
    [
      "still parsing",
      { ...parsedResume, content: null },
      "This resume is still being processed. Try again in a minute.",
    ],
    [
      "failed to parse",
      { ...parsedResume, content: null, parsing_failed: true },
      "This resume couldn't be read. Ask the user to upload it again.",
    ],
  ])("refuses a resume that is %s", async (_label, resume, error) => {
    supabase.queue("resumes", { data: resume, error: null });

    expect(await execTool(tools.startResumeReview, { resumeId: RESUME_ID, jobId: JOB_ID })).toEqual({
      error,
    });
    expect(createResumeReviewAction).not.toHaveBeenCalled();
  });

  it("maps the action's credit error", async () => {
    supabase.queue("resumes", { data: parsedResume, error: null });
    vi.mocked(createResumeReviewAction).mockResolvedValue({
      error: "Insufficient AI credits (5 required).",
    });

    expect(
      await execTool(tools.startResumeReview, { resumeId: RESUME_ID, jobId: JOB_ID }),
    ).toMatchObject({ error: "INSUFFICIENT_CREDITS" });
    expect(startReviewAnalysis).not.toHaveBeenCalled();
  });

  it("passes other action errors through", async () => {
    supabase.queue("resumes", { data: parsedResume, error: null });
    vi.mocked(createResumeReviewAction).mockResolvedValue({
      error: "Job description not found for the provided job.",
    });

    expect(await execTool(tools.startResumeReview, { resumeId: RESUME_ID, jobId: JOB_ID })).toEqual({
      error: "Job description not found for the provided job.",
    });
  });

  it.each([
    [402, { error: "INSUFFICIENT_CREDITS" }],
    [422, { error: "Resume not indexed", reviewId: REVIEW_ID, url: `/resume-review/${REVIEW_ID}` }],
  ])("reports analysis start failures (%i) with the draft review", async (status, expected) => {
    supabase.queue("resumes", { data: parsedResume, error: null });
    vi.mocked(startReviewAnalysis).mockResolvedValue({
      ok: false,
      status,
      error: "Resume not indexed",
    });

    expect(
      await execTool(tools.startResumeReview, { resumeId: RESUME_ID, jobId: JOB_ID }),
    ).toMatchObject(expected);
  });
});

describe("getResumeReview tool", () => {
  it("returns a condensed review with the top suggestions first", async () => {
    supabase.queue("resume_reviews", {
      data: {
        id: REVIEW_ID,
        name: "Acme review",
        status: "completed",
        score: 72,
        analysis_failed: false,
        created_at: "c",
        ai_response: {
          overall_feedback: "Good, needs metrics.",
          bullet_points: [
            { section: "A", original: "o1", suggested: "s1", reason: "r1", priority: "low" },
            { section: "B", original: "o2", suggested: "s2", reason: "r2", priority: "high" },
            { section: "C", original: "o3", suggested: "s3", reason: "r3", priority: "medium" },
            ...Array.from({ length: 5 }, (_, i) => ({
              section: "D",
              original: `x${i}`,
              suggested: "y",
              reason: "z",
              priority: "low",
            })),
          ],
        },
      },
      error: null,
    });

    const result = (await execTool(tools.getResumeReview, { reviewId: REVIEW_ID })) as {
      suggestions: { priority: string }[];
    };

    expect(supabase.callsFor("resume_reviews")[0].chain).toEqual([
      {
        method: "select",
        args: ["id, name, status, score, analysis_failed, ai_response, created_at"],
      },
      { method: "eq", args: ["id", REVIEW_ID] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(result).toMatchObject({
      id: REVIEW_ID,
      name: "Acme review",
      status: "completed",
      score: 72,
      overallFeedback: "Good, needs metrics.",
      totalSuggestions: 8,
      url: `/resume-review/${REVIEW_ID}`,
    });
    expect(result.suggestions).toHaveLength(5);
    expect(result.suggestions.slice(0, 3).map((s) => s.priority)).toEqual(["high", "medium", "low"]);
  });

  it("handles reviews without an analysis yet", async () => {
    supabase.queue("resume_reviews", {
      data: { id: REVIEW_ID, name: null, status: "processing", score: null, analysis_failed: false, ai_response: null, created_at: "c" },
      error: null,
    });

    expect(await execTool(tools.getResumeReview, { reviewId: REVIEW_ID })).toMatchObject({
      status: "processing",
      overallFeedback: null,
      suggestions: [],
      totalSuggestions: 0,
    });
  });

  it("reports failed analyses", async () => {
    supabase.queue("resume_reviews", {
      data: { id: REVIEW_ID, name: null, status: "failed", score: null, analysis_failed: true, ai_response: null, created_at: "c" },
      error: null,
    });

    expect(await execTool(tools.getResumeReview, { reviewId: REVIEW_ID })).toMatchObject({
      status: "failed",
    });
  });

  it("returns an error for unknown reviews", async () => {
    expect(await execTool(tools.getResumeReview, { reviewId: REVIEW_ID })).toEqual({
      error: "Resume review not found.",
    });
  });
});
