import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCompanyTools } from "./company";
import { createJobTools } from "./jobs";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { upsertJobPosting } from "@/helpers/jobs/upsert-job-posting";
import { setJobPostStatus } from "@/helpers/jobs/set-job-post-status";
import { execTool, inputJsonSchema, recruiterToolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { RA_JOB_DESCRIPTION_MAX_CHARS } from "../config";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));
vi.mock("@/helpers/jobs/upsert-job-posting", () => ({ upsertJobPosting: vi.fn() }));
vi.mock("@/helpers/jobs/set-job-post-status", () => ({ setJobPostStatus: vi.fn() }));

const JOB = jobPostingOf(COMPANY_A, {
  title: "Senior Backend Engineer",
  description: "Build APIs in Go.",
  status: "active",
  matching_status: "completed",
  questions: ["Why us?"],
  skills: ["Go", "Postgres"],
});
const OTHER_ID = "b0000000-0000-4000-8000-0000000000ff";

const AT_LIMIT = {
  code: "entitlement" as const,
  message: "Your plan allows 1 active job post. Upgrade to add more.",
  key: "active_job_posts" as const,
  kind: "limit" as const,
  qty: 1,
  used: 1,
  amount: 1,
  overageCredits: null,
  creditBalance: 0,
  creditsNeeded: 0,
  reason: "limit_reached" as const,
  suggestedTier: null,
};

const DRAFT = {
  title: "Founding Backend Engineer",
  description: "Own our Go services end to end.",
  locations: ["Bengaluru"],
  jobType: "Fulltime",
  salaryCurrency: "₹",
  minSalary: 3000000,
  maxSalary: 4000000,
  minExperience: 4,
  maxExperience: 8,
  visaSponsorship: "Not Required",
  skills: ["Go", "Postgres"],
  questions: ["What have you built in Go?"],
};

let supabase: SupabaseMock;
let tools: ReturnType<typeof createJobTools> & ReturnType<typeof createCompanyTools>;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  const ctx = recruiterToolContext(supabase.client);
  tools = { ...createCompanyTools(ctx), ...createJobTools(ctx) };
});

describe("recruiter job tool schemas", () => {
  it("never take a company or user id (RA-SEC-002)", async () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(JSON.stringify(await inputJsonSchema(tool)), name).not.toMatch(/company_?id|user_?id/i);
    }
  });

  it("can't set the status when creating a job post", async () => {
    expect((await validateInput(tools.createJobPost, { ...DRAFT, status: "active" })).success).toBe(
      false,
    );
  });

  it("needs at least one field to update", async () => {
    expect((await validateInput(tools.updateJobPost, { jobPostId: JOB.id })).success).toBe(false);
  });
});

describe("getMyCompany tool", () => {
  it("returns the plan, credits and remaining limits from the session's company", async () => {
    vi.mocked(getEntitlements).mockResolvedValue({
      tier: { id: "t", slug: "startup", name: "Startup" },
      creditBalance: 7,
      period: { start: "2026-10-01", end: "2026-11-01" },
      entitlements: {
        active_job_posts: { kind: "limit", amount: 5, used: 2, held: 0, remaining: 3, overageCredits: null },
        screenings: { kind: "allowance", amount: null, used: 4, held: 0, remaining: null, overageCredits: null },
      },
    } as never);

    const result = await execTool(tools.getMyCompany, {});

    expect(getEntitlements).toHaveBeenCalledWith(COMPANY_A.id);
    expect(result).toEqual({
      name: "Acme",
      plan: "Startup",
      creditBalance: 7,
      periodEnds: "2026-11-01",
      limits: {
        active_job_posts: { used: 2, limit: 5, remaining: 3 },
        screenings: { used: 4, limit: "unlimited", remaining: "unlimited" },
      },
      billingUrl: "/company/billing",
    });
  });
});

describe("listMyJobs tool", () => {
  it("lists the company's jobs from the summaries RPC", async () => {
    supabase.queueRpc("get_recruiter_job_summaries", {
      data: [
        {
          id: JOB.id,
          title: JOB.title,
          status: "active",
          matching_status: "completed",
          applicants: 4,
          new_24h: 1,
          created_at: "c",
          updated_at: "u",
        },
      ],
      error: null,
    });

    const result = await execTool(tools.listMyJobs, { status: "active", limit: 5 });

    expect(supabase.callsFor("get_recruiter_job_summaries")[0].chain[0].args[1]).toEqual({
      p_company_id: COMPANY_A.id,
      p_status: "active",
      p_limit: 5,
    });
    expect(result).toEqual({
      jobs: [
        {
          id: JOB.id,
          title: JOB.title,
          status: "active",
          matchingStatus: "completed",
          applicants: 4,
          newInLast24h: 1,
          url: `/company/job-posts/${JOB.id}`,
        },
      ],
    });
  });
});

describe("getJobPost tool", () => {
  it("returns the company's job with a sandboxed, trimmed description and counts", async () => {
    supabase.queue("job_postings", {
      data: { ...JOB, description: "x".repeat(RA_JOB_DESCRIPTION_MAX_CHARS + 100) },
      error: null,
    });
    supabase.queue("applications", {
      data: [{ status: "submitted" }, { status: "submitted" }, { status: "reviewed" }],
      error: null,
    });

    const result = (await execTool(tools.getJobPost, { jobPostId: JOB.id })) as Record<string, unknown>;

    expect(supabase.callsFor("job_postings")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
    expect(result.title).toBe(JOB.title);
    expect(result.description).toMatch(/^<job_description>\n/);
    expect(String(result.description).length).toBeLessThan(RA_JOB_DESCRIPTION_MAX_CHARS + 60);
    expect(result.applicantsByStatus).toEqual({ submitted: 2, reviewed: 1 });
    expect(result.questions).toEqual(["Why us?"]);
    expect(result.url).toBe(`/company/job-posts/${JOB.id}`);
  });

  it("treats another company's job as not found", async () => {
    supabase.queue("job_postings", { data: null, error: null });

    expect(await execTool(tools.getJobPost, { jobPostId: OTHER_ID })).toEqual({
      error: "Job post not found.",
    });
  });
});

describe("createJobPost tool", () => {
  it("creates an inactive posting for the session's company and links to it", async () => {
    vi.mocked(upsertJobPosting).mockResolvedValue({ success: true, isUpdate: false, postingId: JOB.id });

    const result = await execTool(tools.createJobPost, DRAFT);

    const [deps, params] = vi.mocked(upsertJobPosting).mock.calls[0];
    expect(deps.company.id).toBe(COMPANY_A.id);
    expect(params).toEqual({
      values: {
        title: DRAFT.title,
        description: DRAFT.description,
        location: ["Bengaluru"],
        job_type: "Fulltime",
        salary_currency: "₹",
        min_salary: 3000000,
        max_salary: 4000000,
        min_experience: 4,
        max_experience: 8,
        visa_sponsorship: "Not Required",
        skills: ["Go", "Postgres"],
        questions: ["What have you built in Go?"],
      },
    });
    expect(result).toEqual({
      id: JOB.id,
      title: DRAFT.title,
      status: "inactive",
      url: `/company/job-posts/${JOB.id}`,
    });
  });

  it("returns a plan-limit error with an upgrade link", async () => {
    vi.mocked(upsertJobPosting).mockResolvedValue({ success: false, error: AT_LIMIT });

    expect(await execTool(tools.createJobPost, DRAFT)).toEqual({
      error: "PLAN_LIMIT",
      message: AT_LIMIT.message,
      upgradeUrl: "/company/billing",
    });
  });

  it("refuses exclusionary requirements in the post", async () => {
    const result = await execTool(tools.createJobPost, {
      ...DRAFT,
      description: "Male candidates only, age below 30.",
    });

    expect(result).toMatchObject({ error: "NOT_JOB_RELATED" });
    expect(upsertJobPosting).not.toHaveBeenCalled();
  });

  it("passes other errors through", async () => {
    vi.mocked(upsertJobPosting).mockResolvedValue({ success: false, error: "Job title is required." });

    expect(await execTool(tools.createJobPost, DRAFT)).toEqual({ error: "Job title is required." });
  });
});

describe("updateJobPost tool", () => {
  it("merges the changes onto the company's current posting", async () => {
    supabase.queue("job_postings", { data: JOB, error: null });
    vi.mocked(upsertJobPosting).mockResolvedValue({ success: true, isUpdate: true, postingId: JOB.id });

    const result = await execTool(tools.updateJobPost, {
      jobPostId: JOB.id,
      maxSalary: 3000000,
      skills: ["Go"],
    });

    expect(supabase.callsFor("job_postings")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
    const [, params] = vi.mocked(upsertJobPosting).mock.calls[0];
    expect(params.existingPostingId).toBe(JOB.id);
    expect(params.values).toMatchObject({
      title: JOB.title,
      description: JOB.description,
      max_salary: 3000000,
      min_salary: JOB.min_salary,
      skills: ["Go"],
      questions: ["Why us?"],
    });
    expect(result).toEqual({
      id: JOB.id,
      updated: ["maxSalary", "skills"],
      url: `/company/job-posts/${JOB.id}`,
    });
  });

  it("treats another company's posting as not found", async () => {
    supabase.queue("job_postings", { data: null, error: null });

    expect(await execTool(tools.updateJobPost, { jobPostId: OTHER_ID, title: "x" })).toEqual({
      error: "Job post not found.",
    });
    expect(upsertJobPosting).not.toHaveBeenCalled();
  });
});

describe("setJobPostStatus tool", () => {
  it("changes the status through the shared helper", async () => {
    vi.mocked(setJobPostStatus).mockResolvedValue({ ok: true });

    expect(await execTool(tools.setJobPostStatus, { jobPostId: JOB.id, status: "active" })).toEqual({
      id: JOB.id,
      status: "active",
      url: `/company/job-posts/${JOB.id}`,
    });
    const [deps, params] = vi.mocked(setJobPostStatus).mock.calls[0];
    expect(deps.company.id).toBe(COMPANY_A.id);
    expect(params).toEqual({ jobPostingId: JOB.id, status: "active" });
  });

  it("maps the limit and not-found errors", async () => {
    vi.mocked(setJobPostStatus).mockResolvedValueOnce({ ok: false, error: AT_LIMIT });
    expect(await execTool(tools.setJobPostStatus, { jobPostId: JOB.id, status: "active" })).toMatchObject(
      { error: "PLAN_LIMIT" },
    );

    vi.mocked(setJobPostStatus).mockResolvedValueOnce({ ok: false, error: "Job posting not found." });
    expect(await execTool(tools.setJobPostStatus, { jobPostId: OTHER_ID, status: "inactive" })).toEqual({
      error: "Job posting not found.",
    });
  });
});
