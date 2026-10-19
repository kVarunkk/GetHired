import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApplicantTools } from "./applicants";
import { createMatchingTools } from "./matching";
import { createRecruiterMemoryTools } from "./memory";
import { explainCandidateMatch } from "@/helpers/matching/explain-candidate-match";
import { queueJobScreenings } from "@/helpers/matching/queue-screenings";
import { upsertMemory } from "@/helpers/agent/memory";
import { EntitlementError } from "@/helpers/billing/errors";
import { execTool, inputJsonSchema, recruiterToolContext } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { APPLICATION, CANDIDATE_PROFILE, INJECTION_LINE, JOB_POST, PII, RESUME_CONTENT } from "@/test/utils/matching";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));
vi.mock("@/helpers/matching/explain-candidate-match", () => ({ explainCandidateMatch: vi.fn() }));
vi.mock("@/helpers/matching/queue-screenings", () => ({ queueJobScreenings: vi.fn() }));
vi.mock("@/helpers/agent/memory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/agent/memory")>()),
  upsertMemory: vi.fn(),
}));

const APP_ID = APPLICATION.id;
const OTHER_APP = "e0000000-0000-4000-8000-0000000000ff";
const SCREENING_RESULT = {
  fit_score: 81,
  recommendation: "yes",
  summary: "Strong React background.",
  strengths: ["Performance work"],
  gaps: [],
  must_have_coverage: [],
  answer_feedback: [],
  flags: [],
};
const PAYLOAD = {
  key: "screenings" as const,
  kind: "allowance" as const,
  qty: 1,
  used: 100,
  amount: 100,
  overageCredits: null,
  creditBalance: 0,
  creditsNeeded: 1,
  reason: "limit_reached" as const,
  suggestedTier: null,
};

const STAGE = { id: "90000000-0000-4000-8000-000000000001", name: "Screening" };

const row = (id: string, created_at: string, screening: unknown) => ({
  id,
  status: "submitted",
  created_at,
  applicant_user_id: CANDIDATE_PROFILE.user_id,
  job_postings: { id: JOB_POST.id, title: JOB_POST.title, company_id: COMPANY_A.id },
  pipeline_stages: STAGE,
  user_info: CANDIDATE_PROFILE,
  application_screenings: screening,
});

let supabase: SupabaseMock;
let tools: ReturnType<typeof createApplicantTools> &
  ReturnType<typeof createMatchingTools> &
  ReturnType<typeof createRecruiterMemoryTools>;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  const ctx = recruiterToolContext(supabase.client);
  tools = { ...createApplicantTools(ctx), ...createMatchingTools(ctx), ...createRecruiterMemoryTools(ctx) };
});

describe("applicant tool schemas", () => {
  it("never take a company or user id (RA-SEC-002)", async () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(JSON.stringify(await inputJsonSchema(tool)), name).not.toMatch(/company_?id|user_?id/i);
    }
  });
});

describe("listApplicants tool", () => {
  it("lists applications to the company's jobs, newest first, without contact details", async () => {
    supabase.queue("applications", {
      data: [row(APP_ID, "2026-10-02", { status: "completed", fit_score: 81, recommendation: "yes" })],
      error: null,
    });

    const result = await execTool(tools.listApplicants, {
      jobPostId: JOB_POST.id,
      stageId: STAGE.id,
      status: "submitted",
    });

    const chain = supabase.callsFor("applications")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["stage_id", STAGE.id] });
    expect(chain).toContainEqual({ method: "eq", args: ["job_postings.company_id", COMPANY_A.id] });
    expect(chain).toContainEqual({ method: "eq", args: ["job_post_id", JOB_POST.id] });
    expect(chain).toContainEqual({ method: "eq", args: ["status", "submitted"] });
    expect(result).toEqual({
      applicants: [
        {
          applicationId: APP_ID,
          candidateId: CANDIDATE_PROFILE.user_id,
          name: PII.name,
          roles: ["Frontend Engineer", "UI Engineer"],
          experienceYears: 5,
          job: { id: JOB_POST.id, title: JOB_POST.title },
          stage: STAGE,
          status: "submitted",
          appliedAt: "2026-10-02",
          screening: "completed",
          fitScore: 81,
          recommendation: "yes",
          url: `/company/applications/${APP_ID}`,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(PII.email);
  });

  it("sorts by fit with unscreened last, and filters by fit and recommendation (RAT-040)", async () => {
    const rows = [
      row("e1", "2026-10-03", null),
      row("e2", "2026-10-02", { status: "completed", fit_score: 62, recommendation: "maybe" }),
      row("e3", "2026-10-01", { status: "completed", fit_score: 91, recommendation: "strong_yes" }),
    ];
    supabase.queue("applications", { data: rows, error: null });
    supabase.queue("applications", { data: rows, error: null });

    const sorted = (await execTool(tools.listApplicants, { sort: "fit" })) as {
      applicants: { applicationId: string }[];
    };
    expect(sorted.applicants.map((a) => a.applicationId)).toEqual(["e3", "e2", "e1"]);

    const filtered = (await execTool(tools.listApplicants, { minFitScore: 60, recommendation: "maybe" })) as {
      applicants: { applicationId: string }[];
    };
    expect(filtered.applicants.map((a) => a.applicationId)).toEqual(["e2"]);
  });
});

describe("getApplication tool", () => {
  function queueApplication() {
    supabase.queue("applications", {
      data: {
        ...APPLICATION,
        job_postings: {
          id: JOB_POST.id,
          title: JOB_POST.title,
          company_id: COMPANY_A.id,
          questions: JOB_POST.questions,
        },
        user_info: CANDIDATE_PROFILE,
      },
      error: null,
    });
    supabase.queue("resumes", { data: { content: RESUME_CONTENT }, error: null });
    supabase.queue("application_screenings", {
      data: {
        id: "sc1",
        application_id: APP_ID,
        status: "completed",
        fit_score: 81,
        recommendation: "yes",
        result: SCREENING_RESULT,
        error_code: null,
        completed_at: "c",
        updated_at: "u",
      },
      error: null,
    });
  }

  it("pairs answers with questions and sandboxes candidate text, with no contact details", async () => {
    queueApplication();

    const result = (await execTool(tools.getApplication, { applicationId: APP_ID })) as Record<
      string,
      unknown
    >;

    expect(supabase.callsFor("applications")[0].chain).toContainEqual({
      method: "eq",
      args: ["job_postings.company_id", COMPANY_A.id],
    });
    expect(result).toMatchObject({
      applicationId: APP_ID,
      status: "submitted",
      job: { id: JOB_POST.id, title: JOB_POST.title },
      candidate: { id: CANDIDATE_PROFILE.user_id, name: PII.name },
      screening: { status: "completed", fitScore: 81, recommendation: "yes" },
      url: `/company/applications/${APP_ID}`,
    });
    const answers = String(result.answers);
    expect(answers).toMatch(/^<application_answers>\n/);
    expect(answers).toContain("Q1: Tell us about a performance problem you fixed.");
    expect(answers).toContain("A3: [no answer]");
    expect(String(result.resumeExcerpt)).toMatch(/^<resume_excerpt>/);
    expect(String(result.resumeExcerpt)).toContain(INJECTION_LINE);
    expect(String((result.screening as { details: string }).details)).toMatch(/^<screening>/);
    const text = JSON.stringify(result);
    for (const value of [PII.email, PII.resumeEmail, PII.resumePhone, PII.resumeUrl]) {
      expect(text).not.toContain(value);
    }
  });

  it("treats another company's application as not found", async () => {
    supabase.queue("applications", { data: null, error: null });

    expect(await execTool(tools.getApplication, { applicationId: OTHER_APP })).toEqual({
      error: "Application not found.",
    });
  });
});

describe("explainMatch tool (RAT-040)", () => {
  const EXPLANATION = { summary: "Fits.", strengths: ["React"], gaps: [], conflicts: [] };

  it("returns the explanation, sandboxed", async () => {
    vi.mocked(explainCandidateMatch).mockResolvedValue({ ok: true, explanation: EXPLANATION, cached: true });

    const result = await execTool(tools.explainMatch, {
      candidateId: CANDIDATE_PROFILE.user_id,
      jobPostId: JOB_POST.id,
    });

    const [deps, params] = vi.mocked(explainCandidateMatch).mock.calls[0];
    expect(deps.company.id).toBe(COMPANY_A.id);
    expect(params).toEqual({ candidateId: CANDIDATE_PROFILE.user_id, jobPostId: JOB_POST.id });
    expect(result).toEqual({
      candidateId: CANDIDATE_PROFILE.user_id,
      jobPostId: JOB_POST.id,
      explanation: `<match_explanation>\n${JSON.stringify(EXPLANATION)}\n</match_explanation>`,
    });
  });

  it.each([
    [{ ok: false, reason: "not_found" }, { error: "Candidate or job post not found." }],
    [{ ok: false, reason: "model", errorCode: "timeout" }, { error: "Couldn't explain this match right now. Please try again." }],
  ])("maps %j", async (failure, expected) => {
    vi.mocked(explainCandidateMatch).mockResolvedValue(failure as never);

    expect(
      await execTool(tools.explainMatch, { candidateId: CANDIDATE_PROFILE.user_id, jobPostId: JOB_POST.id }),
    ).toEqual(expected);
  });

  it("maps a used-up allowance to PLAN_LIMIT", async () => {
    vi.mocked(explainCandidateMatch).mockResolvedValue({
      ok: false,
      reason: "entitlement",
      error: new EntitlementError({ ...PAYLOAD, key: "match_explanations" }),
    });

    expect(
      await execTool(tools.explainMatch, { candidateId: CANDIDATE_PROFILE.user_id, jobPostId: JOB_POST.id }),
    ).toMatchObject({ error: "PLAN_LIMIT", upgradeUrl: "/company/billing" });
  });
});

describe("screenApplicants tool (RAT-040)", () => {
  it("queues screenings for the company's job", async () => {
    vi.mocked(queueJobScreenings).mockResolvedValue({ ok: true, queued: 4 });

    expect(await execTool(tools.screenApplicants, { jobPostId: JOB_POST.id })).toEqual({
      jobPostId: JOB_POST.id,
      queued: 4,
    });
    expect(vi.mocked(queueJobScreenings).mock.calls[0][1]).toBe(JOB_POST.id);
  });

  it("maps not found and the screenings allowance", async () => {
    vi.mocked(queueJobScreenings).mockResolvedValueOnce({ ok: false, reason: "not_found" });
    expect(await execTool(tools.screenApplicants, { jobPostId: JOB_POST.id })).toEqual({
      error: "Job post not found.",
    });

    vi.mocked(queueJobScreenings).mockResolvedValueOnce({
      ok: false,
      reason: "entitlement",
      error: new EntitlementError(PAYLOAD),
    });
    expect(await execTool(tools.screenApplicants, { jobPostId: JOB_POST.id })).toMatchObject({
      error: "PLAN_LIMIT",
    });
  });
});

describe("recruiter saveMemory", () => {
  it("refuses content about protected characteristics (RA-SEC-004)", async () => {
    const result = await execTool(tools.saveMemory, {
      content: "We prefer unmarried candidates under 30",
      category: "preference",
    });

    expect(result).toMatchObject({ error: "NOT_JOB_RELATED" });
    expect(upsertMemory).not.toHaveBeenCalled();
  });

  it("saves hiring context", async () => {
    vi.mocked(upsertMemory).mockResolvedValue({
      ok: true,
      status: "created",
      memory: { id: "a1b2c3d4-0000-4000-8000-000000000001", category: "fact", content: "Bar: senior Go" },
    } as never);

    expect(
      await execTool(tools.saveMemory, { content: "Bar: senior Go", category: "fact" }),
    ).toMatchObject({ status: "created" });
  });

  it("describes memories as hiring context", () => {
    expect(tools.saveMemory.description).toMatch(/hiring/i);
  });
});
