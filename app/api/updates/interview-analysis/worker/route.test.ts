import { beforeEach, describe, expect, it, vi } from "vitest";
import { headers } from "next/headers";
import { GET } from "./route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { generateInterviewAnalysis } from "@/helpers/interview/interview-analysis";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";

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

const ANALYSIS_ID = "a1000000-0000-4000-8000-000000000001";
const SESSION_ID = "a2000000-0000-4000-8000-000000000001";
const INTERVIEW_ID = "a3000000-0000-4000-8000-000000000001";
const USER_ID = "a4000000-0000-4000-8000-000000000001";
const ALL_JOBS_ID = "a5000000-0000-4000-8000-000000000001";

const CANDIDATE_REPORT = {
  overall_feedback: "Good.",
  strengths: [],
  improvement_areas: [],
  communication: { score: 4, feedback: "Clear." },
  role_fit: { score: 4, feedback: "Fits." },
  practice_tips: ["Use STAR."],
};
const COMPANY_REPORT = {
  summary: "Strong debugging evidence.",
  competencies: [{ name: "Debugging", score: 4, evidence: "Leak story." }],
  evidence_quotes: [],
  concerns: [],
  follow_up_questions: ["How did you test it?"],
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

function queueRow(perspective: "candidate" | "company", overrides: Record<string, unknown> = {}) {
  supabase.queueRpc("read", { data: [{ msg_id: 9, read_ct: 1, message: { analysisId: ANALYSIS_ID } }], error: null }, "pgmq_public");
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
    data: { id: SESSION_ID, interview_id: INTERVIEW_ID, turns: [{ assistant: "Tell me about a bug.", user: "A memory leak." }] },
    error: null,
  });
  supabase.queue("interviews", { data: { id: INTERVIEW_ID, user_id: USER_ID, job_id: ALL_JOBS_ID }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase.client);
  vi.mocked(headers).mockResolvedValue(new Headers({ "X-Internal-Secret": "test-secret" }) as never);
});

describe("GET /api/updates/interview-analysis/worker", () => {
  it("rejects a wrong secret", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({ "X-Internal-Secret": "nope" }) as never);

    expect((await GET()).status).toBe(401);
    expect(supabase.calls).toHaveLength(0);
  });

  describe("candidate perspective (unchanged)", () => {
    it("scores against the interview's all_jobs row and emails the candidate", async () => {
      queueRow("candidate");
      supabase.queue("user_info", { data: { email: "ada@example.com", full_name: "Ada" }, error: null });
      supabase.queue("all_jobs", { data: { job_name: "Engineer", description: "Build things." }, error: null });
      vi.mocked(generateInterviewAnalysis).mockResolvedValue(CANDIDATE_REPORT);

      const res = await GET();

      expect(await res.json()).toMatchObject({ completed: 1, failed: 0 });
      expect(generateInterviewAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({ perspective: "candidate", candidateName: "Ada", jobTitle: "Engineer" }),
      );
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: "ada@example.com" }));
      expect(updatesOf()).toContainEqual(expect.objectContaining({ notification_sent_at: expect.any(String) }));
      expect(supabase.callsFor("application_attachments")).toHaveLength(0);
      expect(deletes()).toHaveLength(1);
    });
  });

  describe("company perspective (ORT-063, difference 10)", () => {
    it("scores against the attached application's job_postings row and sends no email", async () => {
      queueRow("company");
      supabase.queue("application_attachments", {
        data: {
          created_at: "2026-10-16T00:00:00.000Z",
          applications: { job_postings: { title: "Senior Backend Engineer", description: "Own our services." } },
        },
        error: null,
      });
      vi.mocked(generateInterviewAnalysis).mockResolvedValue(COMPANY_REPORT);

      const res = await GET();

      expect(await res.json()).toMatchObject({ completed: 1, failed: 0 });
      expect(generateInterviewAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({
          perspective: "company",
          jobTitle: "Senior Backend Engineer",
          jobDescription: "Own our services.",
        }),
      );
      const attachments = supabase.callsFor("application_attachments")[0];
      expect(attachments.chain).toContainEqual({ method: "eq", args: ["interview_session_id", SESSION_ID] });
      expect(supabase.callsFor("all_jobs")).toHaveLength(0);
      expect(supabase.callsFor("user_info")).toHaveLength(0);
      expect(sendEmail).not.toHaveBeenCalled();
      expect(updatesOf()).toContainEqual(expect.objectContaining({ status: "completed", result: COMPANY_REPORT }));
      // Marked, so the row is never retried for an email.
      expect(updatesOf()).toContainEqual(expect.objectContaining({ notification_sent_at: expect.any(String) }));
      expect(deletes()).toHaveLength(1);
    });

    it("reuses a stored company report without calling the model", async () => {
      queueRow("company", { status: "completed", result: COMPANY_REPORT });

      await GET();

      expect(generateInterviewAnalysis).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
      expect(deletes()).toHaveLength(1);
    });

    it("fails the message, without a model call, when no application shares the session", async () => {
      queueRow("company");
      supabase.queue("application_attachments", { data: null, error: null });
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await GET();

      expect(await res.json()).toMatchObject({ completed: 0, failed: 1 });
      expect(generateInterviewAnalysis).not.toHaveBeenCalled();
      expect(deletes()).toHaveLength(0);
      spy.mockRestore();
    });
  });
});
