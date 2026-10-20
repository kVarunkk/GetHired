import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCompanyTools } from "./company";
import { createJobTools } from "./jobs";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { upsertJobPosting } from "@/helpers/jobs/upsert-job-posting";
import { setJobPostStatus } from "@/helpers/jobs/set-job-post-status";
import { deleteJobPost } from "@/helpers/jobs/delete-job-post";
import { execTool, inputJsonSchema, recruiterToolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { ADMIN_A, MEMBER_A } from "@/test/utils/team";
import { RA_JOB_DESCRIPTION_MAX_CHARS } from "../config";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));
vi.mock("@/helpers/jobs/upsert-job-posting", () => ({ upsertJobPosting: vi.fn() }));
vi.mock("@/helpers/jobs/set-job-post-status", () => ({ setJobPostStatus: vi.fn() }));
vi.mock("@/helpers/jobs/delete-job-post", () => ({ deleteJobPost: vi.fn() }));

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
  it("returns the company's job with a sandboxed, trimmed description, its form and counts", async () => {
    const qid = "00000000-0000-4000-8000-000000000007";
    const rule = { fail_if: { kind: "equals", value: false }, action: "flag" };
    supabase.queue("job_postings", {
      data: {
        ...JOB,
        description: "x".repeat(RA_JOB_DESCRIPTION_MAX_CHARS + 100),
        department: "Engineering",
        application_form: {
          version: 1,
          questions: [{ id: qid, type: "yes_no", label: "Can you relocate?", required: true }],
          standard_fields: {},
        },
      },
      error: null,
    });
    supabase.queue("job_posting_form_rules", { data: { rules: { questions: { [qid]: rule }, standard: {} } }, error: null });
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
    expect(result.department).toBe("Engineering");
    expect(result.applicationForm).toMatchObject({
      questions: [{ id: qid, label: "Can you relocate?", knockout: rule }],
    });
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

  it("keeps the typed form and its knockout rules when other fields change (CPT-023)", async () => {
    const qid = "00000000-0000-4000-8000-000000000007";
    const form = {
      version: 1,
      questions: [{ id: qid, type: "yes_no", label: "Can you relocate?", required: true }],
      standard_fields: { phone: "optional" },
    };
    const rule = { fail_if: { kind: "equals", value: false }, action: "flag" };
    supabase.queue("job_postings", { data: { ...JOB, application_form: form }, error: null });
    supabase.queue("job_posting_form_rules", { data: { rules: { questions: { [qid]: rule }, standard: {} } }, error: null });
    vi.mocked(upsertJobPosting).mockResolvedValue({ success: true, isUpdate: true, postingId: JOB.id });

    await execTool(tools.updateJobPost, { jobPostId: JOB.id, title: "Staff Backend Engineer" });

    const [, params] = vi.mocked(upsertJobPosting).mock.calls[0];
    expect(params.values.application_form).toEqual({
      ...form,
      questions: [{ ...form.questions[0], knockout: rule }],
      standard_knockouts: undefined,
    });
  });

  it("replaces the form when the agent drafts one", async () => {
    supabase.queue("job_postings", { data: JOB, error: null });
    vi.mocked(upsertJobPosting).mockResolvedValue({ success: true, isUpdate: true, postingId: JOB.id });
    const applicationForm = {
      version: 1,
      questions: [{ id: "00000000-0000-4000-8000-000000000008", type: "short_text", label: "GitHub handle?", required: false }],
      standard_fields: {},
    };

    await execTool(tools.updateJobPost, { jobPostId: JOB.id, applicationForm });

    const [, params] = vi.mocked(upsertJobPosting).mock.calls[0];
    expect(params.values.application_form).toEqual(applicationForm);
  });

  it("keeps answered questions, archived, when the agent's form drops them (AF-REQ-005)", async () => {
    const answered = { id: "00000000-0000-4000-8000-000000000007", type: "yes_no", label: "Can you relocate?", required: true };
    const unanswered = { id: "00000000-0000-4000-8000-000000000009", type: "short_text", label: "Pronouns?", required: false };
    supabase.queue("job_postings", {
      data: { ...JOB, application_form: { version: 1, questions: [answered, unanswered], standard_fields: {} } },
      error: null,
    });
    supabase.queue("applications", { data: [{ answers: [], answers_v2: { [answered.id]: true } }], error: null });
    vi.mocked(upsertJobPosting).mockResolvedValue({ success: true, isUpdate: true, postingId: JOB.id });
    const fresh = { id: "00000000-0000-4000-8000-000000000008", type: "short_text", label: "GitHub handle?", required: false };

    await execTool(tools.updateJobPost, {
      jobPostId: JOB.id,
      applicationForm: { version: 1, questions: [fresh], standard_fields: {} },
    });

    const [, params] = vi.mocked(upsertJobPosting).mock.calls[0];
    expect(params.values.application_form?.questions).toEqual([fresh, { ...answered, archived: true }]);
  });

  it("keeps the department and workplace type when other fields change", async () => {
    supabase.queue("job_postings", { data: { ...JOB, department: "Engineering", workplace_type: "hybrid" }, error: null });
    vi.mocked(upsertJobPosting).mockResolvedValue({ success: true, isUpdate: true, postingId: JOB.id });

    await execTool(tools.updateJobPost, { jobPostId: JOB.id, title: "Staff Backend Engineer" });

    const [, params] = vi.mocked(upsertJobPosting).mock.calls[0];
    expect(params.values).toMatchObject({ department: "Engineering", workplace_type: "hybrid" });
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

describe("deleteJobPost tool", () => {
  it("deletes through the shared helper, within the session company", async () => {
    vi.mocked(deleteJobPost).mockResolvedValue({ ok: true, title: JOB.title });

    expect(await execTool(tools.deleteJobPost, { jobPostId: JOB.id })).toEqual({
      id: JOB.id,
      title: JOB.title,
      deleted: true,
    });
    const [deps, params] = vi.mocked(deleteJobPost).mock.calls[0];
    expect(deps.company.id).toBe(COMPANY_A.id);
    expect(params).toEqual({ jobPostingId: JOB.id });
  });

  it("passes on the helper's error", async () => {
    vi.mocked(deleteJobPost).mockResolvedValue({ ok: false, error: "Job posting not found." });

    expect(await execTool(tools.deleteJobPost, { jobPostId: OTHER_ID })).toEqual({
      error: "Job posting not found.",
    });
  });

  it("only takes a job post id", async () => {
    expect((await validateInput(tools.deleteJobPost, { jobPostId: "nope" })).success).toBe(false);
    expect(Object.keys((await inputJsonSchema(tools.deleteJobPost)).properties ?? {})).toEqual(["jobPostId"]);
  });
});

describe("job write tools for a member (TM-REQ-004, teams difference 15)", () => {
  // RP-REQ-031: the catalog's message for each missing permission.
  const NO_CREATE = { error: "Your role can't create job posts." };
  const NO_EDIT = { error: "Your role can't edit job posts." };
  const NO_PUBLISH = { error: "Your role can't open, pause or close job posts." };
  const NO_DELETE = { error: "Your role can't delete job posts." };

  beforeEach(() => {
    const ctx = recruiterToolContext(supabase.client, { user: MEMBER_A.user, company: MEMBER_A.myCompany });
    tools = { ...createCompanyTools(ctx), ...createJobTools(ctx) };
  });

  it("refuses create, edit and close without querying", async () => {
    expect(await execTool(tools.createJobPost, DRAFT)).toEqual(NO_CREATE);
    expect(await execTool(tools.updateJobPost, { jobPostId: JOB.id, title: "Staff Engineer" })).toEqual(NO_EDIT);
    expect(await execTool(tools.setJobPostStatus, { jobPostId: JOB.id, status: "inactive" })).toEqual(NO_PUBLISH);
    expect(await execTool(tools.deleteJobPost, { jobPostId: JOB.id })).toEqual(NO_DELETE);

    expect(supabase.calls).toHaveLength(0);
    expect(upsertJobPosting).not.toHaveBeenCalled();
    expect(setJobPostStatus).not.toHaveBeenCalled();
    expect(deleteJobPost).not.toHaveBeenCalled();
  });

  it("still lists and reads the company's jobs", async () => {
    supabase.queue("job_postings", { data: [JOB], error: null });

    expect(await execTool(tools.listMyJobs, {})).not.toHaveProperty("error");
  });

  it("lets an admin close a job", async () => {
    const ctx = recruiterToolContext(supabase.client, { user: ADMIN_A.user, company: ADMIN_A.myCompany });
    tools = { ...createCompanyTools(ctx), ...createJobTools(ctx) };
    vi.mocked(setJobPostStatus).mockResolvedValue({ ok: true });

    expect(await execTool(tools.setJobPostStatus, { jobPostId: JOB.id, status: "inactive" })).toMatchObject({
      status: "inactive",
    });
  });
});
