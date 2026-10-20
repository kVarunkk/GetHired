import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResumeTools } from "./resumes";
import { execTool, toolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { setPrimaryResumeAction } from "@/app/actions/set-primary-resume";
import { createResumeReviewAction } from "@/app/actions/create-resume-review";
import { startReviewAnalysis } from "@/helpers/resume-review/start-review-analysis";
import { rankResumesForJob, type ResumeFit } from "@/helpers/resume-review/rank-resumes-for-job";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { shortlistResumes } from "@/helpers/resume-review/shortlist-resumes";

vi.mock("@/app/actions/set-primary-resume", () => ({ setPrimaryResumeAction: vi.fn() }));
vi.mock("@/helpers/resume-review/rank-resumes-for-job", () => ({
  rankResumesForJob: vi.fn(),
  RESUME_PICK_MAX_RESUMES: 5,
  RESUME_PICK_CREDITS: 1,
}));
vi.mock("@/helpers/resume-review/shortlist-resumes", () => ({
  shortlistResumes: vi.fn(),
  RESUME_SHORTLIST_MAX: 50,
}));
vi.mock("@/helpers/ai/deduct-user-credits", () => ({ deductUserCreditsHelper: vi.fn() }));
vi.mock("@/helpers/agent/telemetry", () => ({ agentTelemetry: () => ({ isEnabled: false }) }));
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
      { method: "limit", args: [50] },
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

describe("pickResumeForJob tool", () => {
  const ready = (id: string, name: string) => ({ id, name, content: { sections: [] } });
  const fit = (id: string, score: number, extra: Partial<ResumeFit> = {}): ResumeFit => ({
    id,
    name: id,
    score,
    matched: [],
    missing: [],
    ...extra,
  });
  const JOB_ROW = {
    id: JOB_ID,
    job_name: "Backend Engineer",
    company_name: "Acme",
    locations: ["Remote"],
    salary_range: null,
    job_type: "Fulltime",
    description: JD,
    created_at: "c",
  };

  beforeEach(() => {
    vi.mocked(rankResumesForJob).mockReset();
    vi.mocked(shortlistResumes)
      .mockReset()
      .mockImplementation(async (_job, resumes, size) => resumes.slice(0, size));
    vi.mocked(deductUserCreditsHelper).mockReset().mockResolvedValue({ success: true });
  });

  it("needs exactly one of jobId or jobDescription", async () => {
    expect((await validateInput(tools.pickResumeForJob, {})).success).toBe(false);
    expect(
      (await validateInput(tools.pickResumeForJob, { jobId: JOB_ID, jobDescription: JD })).success,
    ).toBe(false);
  });

  it("ranks the user's ready resumes for a job, then charges 1 credit", async () => {
    supabase.queue("resumes", { data: [ready("r1", "Primary"), ready("r2", "Backend")], error: null });
    supabase.queue("all_jobs", { data: JOB_ROW, error: null });
    supabase.queue("user_info", { data: { ai_credits: 3 }, error: null });
    vi.mocked(rankResumesForJob).mockResolvedValue({
      requirements: [{ text: "Go", importance: "must" }],
      resumes: [
        fit("r2", 100, { matched: [{ requirement: "Go", quote: "Built APIs in Go" }] }),
        fit("r1", 0, { missing: [{ text: "Go", importance: "must" }] }),
      ],
    });

    const result = await execTool(tools.pickResumeForJob, { jobId: JOB_ID });

    expect(supabase.callsFor("resumes")[0].chain).toEqual([
      { method: "select", args: ["id, name, content"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "eq", args: ["parsing_failed", false] },
      { method: "not", args: ["content", "is", null] },
      { method: "order", args: ["is_primary", { ascending: false }] },
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "limit", args: [51] },
    ]);
    expect(rankResumesForJob).toHaveBeenCalledWith(
      { title: "Backend Engineer", company: "Acme", description: JD },
      [
        { id: "r1", name: "Primary", content: { sections: [] } },
        { id: "r2", name: "Backend", content: { sections: [] } },
      ],
      expect.anything(),
    );
    expect(deductUserCreditsHelper).toHaveBeenCalledWith(supabase.client, "u1", 1);
    expect(result).toMatchObject({
      job: { id: JOB_ID, title: "Backend Engineer", url: `/jobs/${JOB_ID}` },
      requirementCount: 1,
      best: { id: "r2", score: 100, matched: [{ requirement: "Go", quote: "Built APIs in Go" }], missing: [] },
      others: [{ id: "r1", score: 0, missing: [{ text: "Go", importance: "must" }] }],
    });
    expect((result as { others: object[] }).others[0]).not.toHaveProperty("matched");
    expect(result).not.toHaveProperty("note");
    expect(result).not.toHaveProperty("shortlisted");
  });

  it("shortlists the closest 5 of many resumes, then ranks only those", async () => {
    const all = Array.from({ length: 8 }, (_, i) => `r${i + 1}`);
    const closest = ["r2", "r4", "r5", "r7", "r8"];
    supabase.queue("resumes", { data: all.map((id) => ready(id, id)), error: null });
    supabase.queue("user_info", { data: { ai_credits: 1 }, error: null });
    vi.mocked(shortlistResumes).mockImplementation(async (_job, resumes) =>
      resumes.filter((resume) => closest.includes(resume.id)),
    );
    vi.mocked(rankResumesForJob).mockResolvedValue({
      requirements: [{ text: "React", importance: "must" }],
      resumes: closest.map((id) => fit(id, 0)),
    });

    const result = await execTool(tools.pickResumeForJob, { jobDescription: JD });

    const [job, candidates, size] = vi.mocked(shortlistResumes).mock.calls[0];
    expect(job).toEqual({ title: null, company: null, description: JD });
    expect(candidates.map((r) => r.id)).toEqual(all);
    expect(size).toBe(5);
    expect(vi.mocked(rankResumesForJob).mock.calls[0][1].map((r) => r.id)).toEqual(closest);
    expect(deductUserCreditsHelper).toHaveBeenCalledTimes(1);
    expect(result).toHaveProperty("shortlisted", expect.stringMatching(/5 closest of the user's 8/));
    expect(result).not.toHaveProperty("note");
  });

  it("says when the user has more resumes than one pick looks at", async () => {
    supabase.queue("resumes", {
      data: Array.from({ length: 51 }, (_, i) => ready(`r${i}`, `r${i}`)),
      error: null,
    });
    supabase.queue("user_info", { data: { ai_credits: 1 }, error: null });
    vi.mocked(rankResumesForJob).mockResolvedValue({
      requirements: [{ text: "React", importance: "must" }],
      resumes: ["r0", "r1", "r2", "r3", "r4"].map((id) => fit(id, 0)),
    });

    const result = await execTool(tools.pickResumeForJob, { jobDescription: JD });

    expect(vi.mocked(shortlistResumes).mock.calls[0][1]).toHaveLength(50);
    expect(result).toHaveProperty("note", expect.stringMatching(/more than 50 resumes/));
  });

  it("doesn't shortlist or rank without a credit", async () => {
    supabase.queue("resumes", { data: [ready("r1", "A"), ready("r2", "B")], error: null });
    supabase.queue("user_info", { data: { ai_credits: 0 }, error: null });

    await execTool(tools.pickResumeForJob, { jobDescription: JD });

    expect(shortlistResumes).not.toHaveBeenCalled();
    expect(rankResumesForJob).not.toHaveBeenCalled();
  });

  describe("with resumeIds", () => {
    const [A, B, C] = [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ];

    it("validates the list", async () => {
      const valid = async (resumeIds: string[]) =>
        (await validateInput(tools.pickResumeForJob, { jobDescription: JD, resumeIds })).success;
      expect(await valid([A])).toBe(false);
      expect(await valid([A, A])).toBe(false);
      const many = Array.from({ length: 51 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`);
      expect(await valid(many)).toBe(false);
      expect(await valid(many.slice(0, 50))).toBe(true);
      expect(await valid([A, B, C])).toBe(true);
    });

    it("compares exactly those resumes, in the user's order", async () => {
      supabase.queue("resumes", {
        data: [
          { ...ready(C, "C"), parsing_failed: false },
          { ...ready(A, "A"), parsing_failed: false },
          { ...ready(B, "B"), parsing_failed: false },
        ],
        error: null,
      });
      supabase.queue("user_info", { data: { ai_credits: 1 }, error: null });
      vi.mocked(rankResumesForJob).mockResolvedValue({
        requirements: [{ text: "React", importance: "must" }],
        resumes: [fit(B, 100), fit(A, 0), fit(C, 0)],
      });

      const result = await execTool(tools.pickResumeForJob, { jobDescription: JD, resumeIds: [B, A, C] });

      expect(supabase.callsFor("resumes")[0].chain).toEqual([
        { method: "select", args: ["id, name, content, parsing_failed"] },
        { method: "eq", args: ["user_id", "u1"] },
        { method: "in", args: ["id", [B, A, C]] },
      ]);
      expect(vi.mocked(rankResumesForJob).mock.calls[0][1].map((r) => r.id)).toEqual([B, A, C]);
      expect(result).toMatchObject({ best: { id: B } });
      expect(result).not.toHaveProperty("note");
    });

    it("refuses resumes that aren't the user's or aren't ready, before spending anything", async () => {
      supabase.queue("resumes", {
        data: [
          { ...ready(A, "A"), parsing_failed: false },
          { id: B, name: "B", content: null, parsing_failed: true },
          { id: C, name: "C", content: null, parsing_failed: false },
        ],
        error: null,
      });

      const result = await execTool(tools.pickResumeForJob, {
        jobDescription: JD,
        resumeIds: [A, B, C, RESUME_ID],
      });

      expect(result).toEqual({
        error: "Some of these resumes can't be compared.",
        resumes: [
          { resumeId: B, reason: "couldn't be read; ask the user to upload it again" },
          { resumeId: C, reason: "still being processed" },
          { resumeId: RESUME_ID, reason: "not found" },
        ],
      });
      expect(supabase.callsFor("user_info")).toHaveLength(0);
      expect(rankResumesForJob).not.toHaveBeenCalled();
    });
  });

  it("compares against a pasted job description", async () => {
    supabase.queue("resumes", { data: [ready("r1", "A"), ready("r2", "B")], error: null });
    supabase.queue("user_info", { data: { ai_credits: 1 }, error: null });
    vi.mocked(rankResumesForJob).mockResolvedValue({
      requirements: [{ text: "React", importance: "must" }],
      resumes: [fit("r1", 50), fit("r2", 0)],
    });

    const result = await execTool(tools.pickResumeForJob, { jobDescription: JD });

    expect(supabase.callsFor("all_jobs")).toHaveLength(0);
    expect(vi.mocked(rankResumesForJob).mock.calls[0][0]).toEqual({ title: null, company: null, description: JD });
    expect(result).toMatchObject({ job: null, best: { id: "r1" } });
  });

  it("is free with one ready resume", async () => {
    supabase.queue("resumes", { data: [ready("r1", "Only")], error: null });

    expect(await execTool(tools.pickResumeForJob, { jobId: JOB_ID })).toMatchObject({
      best: { id: "r1", name: "Only" },
      others: [],
    });
    expect(rankResumesForJob).not.toHaveBeenCalled();
    expect(deductUserCreditsHelper).not.toHaveBeenCalled();
  });

  it("asks for an upload when there are no ready resumes", async () => {
    supabase.queue("resumes", { data: [], error: null });

    expect(await execTool(tools.pickResumeForJob, { jobId: JOB_ID })).toEqual({
      error: "The user has no ready resumes. Ask them to upload one.",
    });
  });

  it("refuses unknown jobs and jobs without a description", async () => {
    supabase.queue("resumes", { data: [ready("r1", "A"), ready("r2", "B")], error: null });
    expect(await execTool(tools.pickResumeForJob, { jobId: JOB_ID })).toEqual({ error: "Job not found." });

    supabase.queue("resumes", { data: [ready("r1", "A"), ready("r2", "B")], error: null });
    supabase.queue("all_jobs", { data: { ...JOB_ROW, description: " " }, error: null });
    expect(await execTool(tools.pickResumeForJob, { jobId: JOB_ID })).toMatchObject({
      error: expect.stringMatching(/no description/),
    });
    expect(rankResumesForJob).not.toHaveBeenCalled();
  });

  it("doesn't call the model without a credit", async () => {
    supabase.queue("resumes", { data: [ready("r1", "A"), ready("r2", "B")], error: null });
    supabase.queue("user_info", { data: { ai_credits: 0 }, error: null });

    expect(await execTool(tools.pickResumeForJob, { jobDescription: JD })).toMatchObject({
      error: "INSUFFICIENT_CREDITS",
    });
    expect(rankResumesForJob).not.toHaveBeenCalled();
    expect(deductUserCreditsHelper).not.toHaveBeenCalled();
  });

  it("reports a failed charge as insufficient credits", async () => {
    supabase.queue("resumes", { data: [ready("r1", "A"), ready("r2", "B")], error: null });
    supabase.queue("user_info", { data: { ai_credits: 1 }, error: null });
    vi.mocked(rankResumesForJob).mockResolvedValue({
      requirements: [{ text: "React", importance: "must" }],
      resumes: [fit("r1", 50), fit("r2", 0)],
    });
    vi.mocked(deductUserCreditsHelper).mockResolvedValue({
      success: false,
      error: "INSUFFICIENT_CREDITS",
      message: "User does not have enough credits.",
    });

    expect(await execTool(tools.pickResumeForJob, { jobDescription: JD })).toMatchObject({
      error: "INSUFFICIENT_CREDITS",
    });
  });

  it("hides model errors from the model", async () => {
    supabase.queue("resumes", { data: [ready("r1", "A"), ready("r2", "B")], error: null });
    supabase.queue("user_info", { data: { ai_credits: 1 }, error: null });
    vi.mocked(rankResumesForJob).mockRejectedValue(new Error("Gemini 500"));

    expect(await execTool(tools.pickResumeForJob, { jobDescription: JD })).toEqual({
      error: "Something went wrong while running pickResumeForJob. Please try again.",
    });
    expect(deductUserCreditsHelper).not.toHaveBeenCalled();
  });
});
