import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApplicationTools } from "./applications";
import { execTool, toolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));

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
