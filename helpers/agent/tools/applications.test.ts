import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApplicationTools } from "./applications";
import { execTool, toolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { submitApplication } from "@/helpers/applications/submit-application";
import { standardAnswerKey } from "@/helpers/applications/validate-answers";

vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));
vi.mock("@/helpers/applications/submit-application", () => ({ submitApplication: vi.fn() }));

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-10-11T12:00:00.000Z";

let supabase: SupabaseMock;
let tools: ReturnType<typeof createApplicationTools>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  supabase = createSupabaseMock();
  tools = createApplicationTools(toolContext(supabase.client));
  return () => vi.useRealTimers();
});

describe("listApplications tool", () => {
  it("lists the user's applications with compact job info", async () => {
    supabase.queue("applications", {
      data: [
        {
          id: "a1",
          status: "reviewed",
          created_at: "2026-10-01T00:00:00.000Z",
          updated_at: "2026-10-02T00:00:00.000Z",
          all_jobs: {
            id: JOB_ID,
            job_name: "Engineer",
            company_name: "Acme",
            locations: ["Remote"],
            is_platform_job: true,
          },
        },
        { id: "a2", status: "submitted", created_at: "c", updated_at: "u", all_jobs: null },
      ],
      error: null,
    });

    const result = await execTool(tools.listApplications, {});

    expect(supabase.callsFor("applications")[0].chain).toEqual([
      {
        method: "select",
        args: [
          "id, status, created_at, updated_at, all_jobs ( id, job_name, company_name, locations, is_platform_job )",
        ],
      },
      { method: "eq", args: ["applicant_user_id", "u1"] },
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "limit", args: [10] },
    ]);
    expect(result).toEqual({
      applications: [
        {
          id: "a1",
          jobId: JOB_ID,
          title: "Engineer",
          company: "Acme",
          locations: ["Remote"],
          status: "reviewed",
          appliedAt: "2026-10-01T00:00:00.000Z",
          updatedAt: "2026-10-02T00:00:00.000Z",
          isPlatformJob: true,
          url: `/jobs/${JOB_ID}`,
        },
        {
          id: "a2",
          jobId: null,
          title: null,
          company: null,
          locations: [],
          status: "submitted",
          appliedAt: "c",
          updatedAt: "u",
          isPlatformJob: false,
          url: null,
        },
      ],
    });
  });

  it("filters by status", async () => {
    await execTool(tools.listApplications, { status: "selected", limit: 3 });

    expect(supabase.callsFor("applications")[0].chain).toContainEqual({
      method: "eq",
      args: ["status", "selected"],
    });
    expect(supabase.callsFor("applications")[0].chain).toContainEqual({
      method: "limit",
      args: [3],
    });
  });

  it("rejects unknown statuses", async () => {
    expect((await validateInput(tools.listApplications, { status: "hired" })).success).toBe(false);
  });
});

describe("updateApplicationStatus tool", () => {
  const externalJob = { id: JOB_ID, is_platform_job: false, job_name: "Engineer", company_name: "Acme" };

  it("updates the user's application for an external job", async () => {
    supabase.queue("all_jobs", { data: externalJob, error: null });
    supabase.queue("applications", { data: [{ id: "a1" }], error: null });

    const result = await execTool(tools.updateApplicationStatus, {
      jobId: JOB_ID,
      status: "rejected",
    });

    expect(supabase.callsFor("all_jobs")[0].chain).toEqual([
      { method: "select", args: ["id, is_platform_job, job_name, company_name"] },
      { method: "eq", args: ["id", JOB_ID] },
      { method: "maybeSingle", args: [] },
    ]);
    expect(supabase.callsFor("applications")[0].chain).toEqual([
      { method: "update", args: [{ status: "rejected", updated_at: NOW }] },
      { method: "eq", args: ["all_jobs_id", JOB_ID] },
      { method: "eq", args: ["applicant_user_id", "u1"] },
      { method: "select", args: ["id"] },
    ]);
    expect(result).toEqual({
      jobId: JOB_ID,
      title: "Engineer",
      company: "Acme",
      status: "rejected",
      created: false,
    });
  });

  it("records an application when the user tracks an external job for the first time", async () => {
    supabase.queue("all_jobs", { data: externalJob, error: null });
    supabase.queue("applications", { data: [], error: null });

    const result = await execTool(tools.updateApplicationStatus, {
      jobId: JOB_ID,
      status: "submitted",
    });

    expect(supabase.callsFor("applications")[1].chain).toEqual([
      {
        method: "insert",
        args: [{ applicant_user_id: "u1", all_jobs_id: JOB_ID, status: "submitted" }],
      },
    ]);
    expect(result).toMatchObject({ status: "submitted", created: true });
  });

  it("refuses platform jobs, whose status is set by the company", async () => {
    supabase.queue("all_jobs", { data: { ...externalJob, is_platform_job: true }, error: null });

    const result = await execTool(tools.updateApplicationStatus, {
      jobId: JOB_ID,
      status: "selected",
    });

    expect(result).toEqual({
      error:
        "This job was applied to through GetHired, so its status is set by the company and can't be changed here.",
    });
    expect(supabase.callsFor("applications")).toHaveLength(0);
  });

  it("returns an error for unknown jobs", async () => {
    expect(
      await execTool(tools.updateApplicationStatus, { jobId: JOB_ID, status: "selected" }),
    ).toEqual({ error: "Job not found." });
  });

  it("returns a generic error when the update fails", async () => {
    supabase.queue("all_jobs", { data: externalJob, error: null });
    supabase.queue("applications", { data: null, error: new Error("db down") });

    expect(
      await execTool(tools.updateApplicationStatus, { jobId: JOB_ID, status: "selected" }),
    ).toEqual({
      error: "Something went wrong while running updateApplicationStatus. Please try again.",
    });
  });
});

const QUESTION_ID = "00000000-0000-4000-8000-000000000001";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";
const FORM = {
  version: 1,
  questions: [
    {
      id: QUESTION_ID,
      type: "yes_no",
      label: "Can you relocate?",
      required: true,
      knockout: { fail_if: { kind: "equals", value: false }, action: "reject" },
    },
  ],
  standard_fields: { linkedin_url: "optional" },
};

function queueTarget({ platform = true, resume = { id: RESUME_ID, name: "Main" } as unknown, applied = false } = {}) {
  supabase.queue("all_jobs", {
    data: { id: JOB_ID, job_name: "Engineer", company_name: "Acme", is_platform_job: platform },
    error: null,
  });
  supabase.queue("job_postings", { data: { status: "active", questions: [], application_form: FORM }, error: null });
  supabase.queue("resumes", { data: resume, error: null });
  supabase.queue("applications", { data: applied ? [{ id: "a1" }] : [], error: null });
}

describe("getApplicationForm tool", () => {
  it("returns the public form sandboxed, the resume and profile suggestions", async () => {
    queueTarget();
    supabase.queue("user_info", { data: { linkedin_url: "https://linkedin.com/in/ada" }, error: null });

    const result = (await execTool(tools.getApplicationForm, { jobId: JOB_ID })) as Record<string, unknown>;

    expect(result).toMatchObject({
      jobId: JOB_ID,
      title: "Engineer",
      company: "Acme",
      canApply: true,
      notReadyReason: null,
      resume: { id: RESUME_ID, name: "Main" },
      suggestedAnswers: [{ key: standardAnswerKey("linkedin_url"), value: "https://linkedin.com/in/ada" }],
    });
    expect(result.fields).toMatch(/^<application_form>/);
    expect(result.fields).toContain("Can you relocate?");
    // AF-SEC-003: knockout rules never reach the agent.
    expect(JSON.stringify(result)).not.toContain("knockout");
    expect(supabase.callsFor("user_info")[0].chain).toContainEqual({ method: "eq", args: ["user_id", "u1"] });
  });

  it("refuses jobs that aren't on GetHired", async () => {
    queueTarget({ platform: false });
    const result = await execTool(tools.getApplicationForm, { jobId: JOB_ID });
    expect(result).toMatchObject({ error: expect.stringContaining("isn't on GetHired") });
  });
});

describe("submitApplication tool", () => {
  it("sends typed answers with the primary resume, as the session user", async () => {
    queueTarget();
    vi.mocked(submitApplication).mockResolvedValue({
      ok: true,
      applicationId: "app-1",
      creditsDeducted: true,
      interview: null,
    });

    const result = await execTool(tools.submitApplication, {
      jobId: JOB_ID,
      answers: [{ key: QUESTION_ID, value: "yes" }],
    });

    expect(submitApplication).toHaveBeenCalledWith(supabase.client, expect.objectContaining({ id: "u1" }), {
      allJobsId: JOB_ID,
      resumeId: RESUME_ID,
      answers: { [QUESTION_ID]: true },
    });
    expect(result).toEqual({
      applied: true,
      jobId: JOB_ID,
      title: "Engineer",
      company: "Acme",
      resume: "Main",
      url: `/jobs/${JOB_ID}`,
    });
  });

  it("passes validation errors back so the agent can fix them", async () => {
    queueTarget();
    vi.mocked(submitApplication).mockResolvedValue({
      ok: false,
      error: "Check your answers and try again.",
      fieldErrors: { [QUESTION_ID]: "Answer yes or no." },
    });

    const result = await execTool(tools.submitApplication, {
      jobId: JOB_ID,
      answers: [{ key: QUESTION_ID, value: "maybe" }],
    });

    expect(result).toEqual({
      error: "Check your answers and try again.",
      fieldErrors: { [QUESTION_ID]: "Answer yes or no." },
    });
  });

  it("doesn't send when the user already applied or has no resume", async () => {
    queueTarget({ applied: true });
    expect(await execTool(tools.submitApplication, { jobId: JOB_ID, answers: [] })).toEqual({
      error: "You've already applied to this job.",
    });

    queueTarget({ resume: null });
    expect(await execTool(tools.submitApplication, { jobId: JOB_ID, answers: [] })).toEqual({
      error: "There's no resume to send. Upload one first.",
    });
    expect(submitApplication).not.toHaveBeenCalled();
  });
});
