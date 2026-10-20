import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { GET } from "./route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { generateInterviewAnalysis } from "@/helpers/interview/interview-analysis";
import { generateScreeningReport, loadScreeningAnalysisInput } from "@/helpers/interview/screening/analysis";
import { notifyCompanyOfCompletedInterview } from "@/helpers/interview/screening/notify-company";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";

// SIT-042: the screening + company branch. The practice cases stay in route.test.ts, unedited.

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({
  INTERNAL_API_SECRET: "test-secret",
  deploymentUrl: () => "http://localhost:3000",
}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));
vi.mock("@/helpers/interview/interview-analysis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/interview/interview-analysis")>()),
  generateInterviewAnalysis: vi.fn(),
}));
vi.mock("@/helpers/interview/screening/analysis", () => ({
  generateScreeningReport: vi.fn(),
  loadScreeningAnalysisInput: vi.fn(),
}));
vi.mock("@/helpers/interview/screening/notify-company", () => ({
  notifyCompanyOfCompletedInterview: vi.fn(),
}));

const ANALYSIS_ID = "a1000000-0000-4000-8000-000000000001";
const SESSION_ID = "a2000000-0000-4000-8000-000000000001";
const INTERVIEW_ID = "a3000000-0000-4000-8000-000000000001";
const USER_ID = "a4000000-0000-4000-8000-000000000001";
const APP_INTERVIEW_ID = "a6000000-0000-4000-8000-000000000001";
const COMPANY_ID = "a7000000-0000-4000-8000-000000000001";

const TURNS = [{ turn_id: 0, timestamp: 1, user: "A memory leak.", assistant: "Thanks.", interrupted: false }];

const REPORT = {
  competencies: [
    { name: "Debugging", score: 4, rationale: "Found the leak.", evidence: [{ turnId: 0, quote: "A memory leak" }] },
  ],
  questionCoverage: [],
  summary: "Strong debugging evidence.",
  strengths: [],
  concerns: [],
  followUpQuestions: [],
  overallScore: 4,
};

const LOADED = {
  snapshot: { job_title: "Backend Engineer" },
  jobDescription: "Own our services.",
  turns: TURNS,
  companyId: COMPANY_ID,
  jobPostId: "j1",
  applicationId: "app1",
};

let supabase: SupabaseMock;

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const updatesOf = () =>
  supabase
    .callsFor("interview_analyses")
    .filter((c) => has(c, "update"))
    .map((c) => c.chain.find((m) => m.method === "update")!.args[0] as Record<string, unknown>);
const deletes = () =>
  supabase.calls.filter((c) => c.kind === "rpc" && c.schema === "pgmq_public" && c.target === "delete");

function queueRow(
  perspective: "candidate" | "company",
  overrides: Record<string, unknown> = {},
  readCount = 1,
) {
  supabase.queueRpc(
    "read",
    { data: [{ msg_id: 9, read_ct: readCount, message: { analysisId: ANALYSIS_ID } }], error: null },
    "pgmq_public",
  );
  supabase.queue("interview_analyses", {
    data: {
      id: ANALYSIS_ID,
      interview_session_id: SESSION_ID,
      perspective,
      status: "queued",
      result: null,
      notification_sent_at: null,
      ...overrides,
    },
    error: null,
  });
  supabase.queue("interview_sessions", {
    data: { id: SESSION_ID, interview_id: INTERVIEW_ID, turns: TURNS },
    error: null,
  });
  supabase.queue("interviews", {
    data: {
      id: INTERVIEW_ID,
      user_id: USER_ID,
      job_id: null,
      kind: "screening",
      application_interview_id: APP_INTERVIEW_ID,
    },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client);
  vi.mocked(headers).mockResolvedValue(new Headers({ "X-Internal-Secret": "test-secret" }) as never);
  vi.mocked(loadScreeningAnalysisInput).mockResolvedValue(LOADED as never);
  vi.mocked(generateScreeningReport).mockResolvedValue(REPORT);
});

describe("GET /api/updates/interview-analysis/worker: screening (SIT-042, SI-TEST-008)", () => {
  it("runs the screening analysis, stores it and emails the company, not the candidate", async () => {
    queueRow("company");

    const res = await GET();

    expect(await res.json()).toMatchObject({ completed: 1, failed: 0 });
    expect(loadScreeningAnalysisInput).toHaveBeenCalledWith(supabase.client, APP_INTERVIEW_ID, TURNS);
    expect(generateScreeningReport).toHaveBeenCalledWith({
      snapshot: LOADED.snapshot,
      jobDescription: LOADED.jobDescription,
      turns: TURNS,
      trace: { analysisId: ANALYSIS_ID, companyId: COMPANY_ID },
    });
    expect(generateInterviewAnalysis).not.toHaveBeenCalled();
    expect(updatesOf()).toContainEqual(expect.objectContaining({ status: "processing" }));
    expect(updatesOf()).toContainEqual(expect.objectContaining({ status: "completed", result: REPORT }));

    expect(notifyCompanyOfCompletedInterview).toHaveBeenCalledWith(supabase.client, APP_INTERVIEW_ID, {
      scored: true,
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(supabase.callsFor("user_info")).toHaveLength(0);
    expect(supabase.callsFor("application_attachments")).toHaveLength(0);
    expect(supabase.callsFor("all_jobs")).toHaveLength(0);
    expect(updatesOf()).toContainEqual(expect.objectContaining({ notification_sent_at: expect.any(String) }));
    expect(deletes()).toHaveLength(1);
  });

  it("reuses a stored report without calling the model, and emails once", async () => {
    queueRow("company", { status: "completed", result: REPORT });

    await GET();

    expect(generateScreeningReport).not.toHaveBeenCalled();
    expect(loadScreeningAnalysisInput).not.toHaveBeenCalled();
    expect(notifyCompanyOfCompletedInterview).toHaveBeenCalledTimes(1);
    expect(deletes()).toHaveLength(1);
  });

  it("doesn't email again when the notification was already sent", async () => {
    queueRow("company", { status: "completed", result: REPORT, notification_sent_at: "2026-10-19T00:00:00Z" });

    await GET();

    expect(notifyCompanyOfCompletedInterview).not.toHaveBeenCalled();
    expect(deletes()).toHaveLength(1);
  });

  it("regenerates a stored result that isn't a screening report", async () => {
    queueRow("company", { status: "completed", result: { summary: "old shape", competencies: [] } });

    await GET();

    expect(generateScreeningReport).toHaveBeenCalledTimes(1);
  });

  it("leaves the message for a retry when the model fails", async () => {
    queueRow("company");
    vi.mocked(generateScreeningReport).mockRejectedValue(new Error("model down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET();

    expect(await res.json()).toMatchObject({ completed: 0, failed: 1 });
    expect(notifyCompanyOfCompletedInterview).not.toHaveBeenCalled();
    expect(deletes()).toHaveLength(0);
    spy.mockRestore();
  });

  it("marks the analysis failed after the last retry, as for practice", async () => {
    queueRow("company", {}, 3);
    vi.mocked(generateScreeningReport).mockRejectedValue(new Error("model down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await GET();

    expect(updatesOf()).toContainEqual(
      expect.objectContaining({ status: "failed", error_code: "analysis_worker_retries_exhausted" }),
    );
    expect(deletes()).toHaveLength(1);
    expect(sendEmailForStatusUpdate).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("refuses a candidate-perspective analysis of a screening session", async () => {
    queueRow("candidate");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET();

    expect(await res.json()).toMatchObject({ completed: 0, failed: 1 });
    expect(generateScreeningReport).not.toHaveBeenCalled();
    expect(generateInterviewAnalysis).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
