import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInterviewTools } from "./interviews";
import { execTool, toolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createInterviewAction } from "@/app/actions/create-interview";

vi.mock("@/app/actions/create-interview", () => ({ createInterviewAction: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

const INTERVIEW_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

const ANALYSIS = {
  overall_feedback: "Clear answers, light on metrics.",
  strengths: [{ title: "Structure", evidence: "Used STAR consistently." }],
  improvement_areas: [
    { title: "Impact", evidence: "No numbers given.", suggestion: "Quantify results." },
  ],
  communication: { score: 4, feedback: "Concise." },
  role_fit: { score: 3, feedback: "Some React gaps." },
  practice_tips: ["Prepare two metric-backed stories."],
};

let supabase: SupabaseMock;
let tools: ReturnType<typeof createInterviewTools>;

beforeEach(() => {
  supabase = createSupabaseMock();
  tools = createInterviewTools(toolContext(supabase.client));
});

describe("listInterviews tool", () => {
  it("lists the user's interviews, newest first, with sessions and analysis status", async () => {
    supabase.queue("interviews", {
      data: [
        {
          id: INTERVIEW_ID,
          name: "Stripe frontend",
          created_at: "2026-10-01",
          all_jobs: { id: JOB_ID, job_name: "Frontend Engineer", company_name: "Stripe" },
          resumes: { id: RESUME_ID, name: "CV 2026" },
          interview_sessions: [
            {
              id: "old",
              started_at: "2026-10-02",
              status: "completed",
              interview_analyses: [
                { status: "completed", perspective: "company" },
                { status: "completed", perspective: "candidate" },
              ],
            },
            {
              id: "new",
              started_at: "2026-10-03",
              status: "completed",
              interview_analyses: [{ status: "processing", perspective: "candidate" }],
            },
          ],
        },
        {
          id: "i2",
          name: null,
          created_at: "2026-09-01",
          all_jobs: null,
          resumes: null,
          interview_sessions: [],
        },
      ],
      error: null,
    });

    const result = await execTool(tools.listInterviews, { limit: 5 });

    expect(supabase.callsFor("interviews")[0].chain).toEqual([
      {
        method: "select",
        args: [
          "id, name, created_at, all_jobs(id, job_name, company_name), resumes(id, name), interview_sessions(id, started_at, status, interview_analyses(status, perspective))",
        ],
      },
      { method: "eq", args: ["user_id", "u1"] },
      // SIT-054: screening interviews aren't the user's practice interviews.
      { method: "eq", args: ["kind", "practice"] },
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "limit", args: [5] },
    ]);
    expect(result).toEqual({
      interviews: [
        {
          id: INTERVIEW_ID,
          name: "Stripe frontend",
          createdAt: "2026-10-01",
          job: { id: JOB_ID, title: "Frontend Engineer", company: "Stripe" },
          resume: { id: RESUME_ID, name: "CV 2026" },
          sessions: [
            { id: "new", startedAt: "2026-10-03", status: "completed", analysis: "processing" },
            { id: "old", startedAt: "2026-10-02", status: "completed", analysis: "completed" },
          ],
          url: `/interview/${INTERVIEW_ID}`,
        },
        {
          id: "i2",
          name: "AI Interview",
          createdAt: "2026-09-01",
          job: null,
          resume: null,
          sessions: [],
          url: "/interview/i2",
        },
      ],
    });
  });

  it("uses the default limit", async () => {
    supabase.queue("interviews", { data: [], error: null });

    expect(await execTool(tools.listInterviews, {})).toEqual({ interviews: [] });
    expect(supabase.callsFor("interviews")[0].chain.at(-1)).toEqual({ method: "limit", args: [10] });
  });
});

describe("getInterviewAnalysis tool", () => {
  const queueInterview = (data: unknown = { id: INTERVIEW_ID, name: "Stripe frontend" }) =>
    supabase.queue("interviews", { data, error: null });

  it("returns the latest session's completed analysis", async () => {
    queueInterview();
    supabase.queue("interview_sessions", {
      data: { id: SESSION_ID, started_at: "2026-10-03", status: "completed" },
      error: null,
    });
    supabase.queue("interview_analyses", {
      data: { status: "completed", result: ANALYSIS },
      error: null,
    });

    const result = await execTool(tools.getInterviewAnalysis, { interviewId: INTERVIEW_ID });

    expect(supabase.callsFor("interviews")[0].chain).toEqual([
      { method: "select", args: ["id, name"] },
      { method: "eq", args: ["id", INTERVIEW_ID] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "eq", args: ["kind", "practice"] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(supabase.callsFor("interview_sessions")[0].chain).toEqual([
      { method: "select", args: ["id, started_at, status"] },
      { method: "eq", args: ["interview_id", INTERVIEW_ID] },
      { method: "order", args: ["started_at", { ascending: false }] },
      { method: "limit", args: [1] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(supabase.callsFor("interview_analyses")[0].chain).toEqual([
      { method: "select", args: ["status, result"] },
      { method: "eq", args: ["interview_session_id", SESSION_ID] },
      { method: "eq", args: ["perspective", "candidate"] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(result).toEqual({
      interviewId: INTERVIEW_ID,
      name: "Stripe frontend",
      sessionId: SESSION_ID,
      status: "completed",
      url: `/interview/${INTERVIEW_ID}/analysis/${SESSION_ID}`,
      overallFeedback: "Clear answers, light on metrics.",
      communication: { score: 4, feedback: "Concise." },
      roleFit: { score: 3, feedback: "Some React gaps." },
      strengths: [{ title: "Structure", evidence: "Used STAR consistently." }],
      improvementAreas: [{ title: "Impact", suggestion: "Quantify results." }],
      practiceTips: ["Prepare two metric-backed stories."],
    });
  });

  it("reads a specific session of the interview", async () => {
    queueInterview();
    supabase.queue("interview_sessions", {
      data: { id: SESSION_ID, started_at: "s", status: "completed" },
      error: null,
    });
    supabase.queue("interview_analyses", { data: { status: "completed", result: ANALYSIS }, error: null });

    await execTool(tools.getInterviewAnalysis, { interviewId: INTERVIEW_ID, sessionId: SESSION_ID });

    expect(supabase.callsFor("interview_sessions")[0].chain).toEqual([
      { method: "select", args: ["id, started_at, status"] },
      { method: "eq", args: ["interview_id", INTERVIEW_ID] },
      { method: "eq", args: ["id", SESSION_ID] },
      { method: "maybeSingle", args: [] },
    ]);
  });

  it("returns not found for another user's interview", async () => {
    queueInterview(null);

    expect(await execTool(tools.getInterviewAnalysis, { interviewId: INTERVIEW_ID })).toEqual({
      error: "Interview not found.",
    });
    expect(supabase.callsFor("interview_sessions")).toHaveLength(0);
  });

  it("explains when the interview hasn't been taken", async () => {
    queueInterview();
    supabase.queue("interview_sessions", { data: null, error: null });

    expect(await execTool(tools.getInterviewAnalysis, { interviewId: INTERVIEW_ID })).toEqual({
      interviewId: INTERVIEW_ID,
      name: "Stripe frontend",
      status: "not_started",
      message: "This interview hasn't been taken yet. The user can start it from the link.",
      url: `/interview/${INTERVIEW_ID}`,
    });
  });

  it.each([
    [null, "pending"],
    [{ status: "processing", result: null }, "processing"],
    [{ status: "failed", result: null }, "failed"],
  ])("reports an analysis that isn't ready (%o)", async (analysis, status) => {
    queueInterview();
    supabase.queue("interview_sessions", {
      data: { id: SESSION_ID, started_at: "s", status: "completed" },
      error: null,
    });
    supabase.queue("interview_analyses", { data: analysis, error: null });

    expect(await execTool(tools.getInterviewAnalysis, { interviewId: INTERVIEW_ID })).toMatchObject({
      interviewId: INTERVIEW_ID,
      sessionId: SESSION_ID,
      status,
      url: `/interview/${INTERVIEW_ID}/analysis/${SESSION_ID}`,
    });
  });

  it("rejects a malformed stored analysis", async () => {
    queueInterview();
    supabase.queue("interview_sessions", {
      data: { id: SESSION_ID, started_at: "s", status: "completed" },
      error: null,
    });
    supabase.queue("interview_analyses", {
      data: { status: "completed", result: { overall_feedback: 1 } },
      error: null,
    });

    expect(await execTool(tools.getInterviewAnalysis, { interviewId: INTERVIEW_ID })).toEqual({
      error: "This analysis couldn't be read.",
    });
  });

  it("requires uuids", async () => {
    expect((await validateInput(tools.getInterviewAnalysis, { interviewId: "x" })).success).toBe(false);
  });
});

describe("createInterview tool", () => {
  const readyResume = { id: RESUME_ID, content: { a: 1 }, parsing_failed: false };

  it("creates an interview for a job with the given resume and returns its link", async () => {
    supabase.queue("resumes", { data: readyResume, error: null });
    vi.mocked(createInterviewAction).mockResolvedValue({ success: true, interviewId: INTERVIEW_ID });

    const result = await execTool(tools.createInterview, {
      jobId: JOB_ID,
      resumeId: RESUME_ID,
      name: "Stripe practice",
    });

    expect(supabase.callsFor("resumes")[0].chain).toEqual([
      { method: "select", args: ["id, content, parsing_failed"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "eq", args: ["id", RESUME_ID] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(createInterviewAction).toHaveBeenCalledWith("Stripe practice", RESUME_ID, JOB_ID);
    expect(result).toEqual({
      interviewId: INTERVIEW_ID,
      url: `/interview/${INTERVIEW_ID}`,
      message:
        "The interview is ready. The user starts it from the link; each session uses 10 AI credits when it starts.",
    });
  });

  it("uses the primary resume when none is given", async () => {
    supabase.queue("resumes", { data: readyResume, error: null });
    vi.mocked(createInterviewAction).mockResolvedValue({ success: true, interviewId: INTERVIEW_ID });

    await execTool(tools.createInterview, { jobId: JOB_ID });

    expect(supabase.callsFor("resumes")[0].chain).toEqual([
      { method: "select", args: ["id, content, parsing_failed"] },
      { method: "eq", args: ["user_id", "u1"] },
      { method: "eq", args: ["is_primary", true] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(createInterviewAction).toHaveBeenCalledWith(null, RESUME_ID, JOB_ID);
  });

  it.each([
    [null, "NO_RESUME"],
    [{ ...readyResume, parsing_failed: true }, "This resume couldn't be read. Ask the user to upload it again."],
    [{ ...readyResume, content: null }, "This resume is still being processed. Try again in a minute."],
  ])("does not create an interview without a usable resume (%o)", async (resume, error) => {
    supabase.queue("resumes", { data: resume, error: null });

    expect(await execTool(tools.createInterview, { jobId: JOB_ID })).toMatchObject({ error });
    expect(createInterviewAction).not.toHaveBeenCalled();
  });

  it.each([
    ["Insufficient AI credits (10 required).", { error: "INSUFFICIENT_CREDITS" }],
    ["Job not found. Please provide a valid job URL.", { error: "Job not found. Please provide a valid job URL." }],
  ])("maps action errors: %s", async (actionError, expected) => {
    supabase.queue("resumes", { data: readyResume, error: null });
    vi.mocked(createInterviewAction).mockResolvedValue({ error: actionError });

    expect(await execTool(tools.createInterview, { jobId: JOB_ID })).toMatchObject(expected);
  });

  it("requires a job uuid", async () => {
    expect((await validateInput(tools.createInterview, {})).success).toBe(false);
  });
});
