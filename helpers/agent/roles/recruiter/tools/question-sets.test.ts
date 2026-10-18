import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQuestionSetTools } from "./question-sets";
import { createRecruiterTools } from "./index";
import { upsertJobPosting } from "@/helpers/jobs/upsert-job-posting";
import { execTool, recruiterToolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { MEMBER_A } from "@/test/utils/team";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));
vi.mock("@/helpers/jobs/upsert-job-posting", () => ({ upsertJobPosting: vi.fn() }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SET_ID = "5e000000-0000-4000-8000-000000000001";
const RELOCATE = { id: id(1), type: "yes_no" as const, label: "Can you relocate?", required: true };
const SET_FORM = { version: 1, questions: [RELOCATE], standard_fields: { phone: "required" } };
const SET_ROW = { id: SET_ID, name: "Engineering", form: SET_FORM, updated_at: "2026-10-17T00:00:00Z" };
const JOB = jobPostingOf(COMPANY_A, { title: "Backend Engineer" });

let supabase: SupabaseMock;
let tools: ReturnType<typeof createQuestionSetTools>;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  tools = createQuestionSetTools(recruiterToolContext(supabase.client));
});

const writeOf = (method: string) =>
  supabase.callsFor("company_question_sets").find((c) => c.chain.some((m) => m.method === method));

describe("listQuestionSets tool", () => {
  it("lists the session company's sets without archived questions", async () => {
    supabase.queue("company_question_sets", {
      data: [{ ...SET_ROW, form: { ...SET_FORM, questions: [RELOCATE, { ...RELOCATE, id: id(2), archived: true }] } }],
      error: null,
    });

    const result = (await execTool(tools.listQuestionSets, {})) as { sets: unknown[] };

    expect(supabase.callsFor("company_question_sets")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
    expect(result.sets).toEqual([
      expect.objectContaining({
        id: SET_ID,
        name: "Engineering",
        questions: [{ label: "Can you relocate?", type: "yes_no", required: true }],
        standardFields: { phone: "required" },
        url: `/company/settings/question-sets/${SET_ID}`,
      }),
    ]);
  });
});

describe("applyQuestionSet tool (AF-REQ-004/005)", () => {
  it("replaces the job's form with a fresh copy and keeps answered questions archived", async () => {
    const answered = { id: id(7), type: "short_text" as const, label: "Why us?", required: true };
    supabase.queue("company_question_sets", { data: [SET_ROW], error: null });
    supabase.queue("job_postings", {
      data: { ...JOB, application_form: { version: 1, questions: [answered], standard_fields: {} } },
      error: null,
    });
    supabase.queue("applications", { data: [{ answers: [], answers_v2: { [answered.id]: "Mission" } }], error: null });
    vi.mocked(upsertJobPosting).mockResolvedValue({ success: true, isUpdate: true, postingId: JOB.id });

    const result = await execTool(tools.applyQuestionSet, { jobPostId: JOB.id, questionSetId: SET_ID });

    expect(result).toEqual({ id: JOB.id, questionSet: "Engineering", url: `/company/job-posts/${JOB.id}` });
    const [, params] = vi.mocked(upsertJobPosting).mock.calls[0];
    expect(params.existingPostingId).toBe(JOB.id);
    const questions = params.values.application_form!.questions;
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({ label: "Can you relocate?", type: "yes_no" });
    expect(questions[0].id).not.toBe(RELOCATE.id);
    expect(questions[1]).toEqual({ ...answered, archived: true });
    expect(params.values.application_form!.standard_fields).toEqual({ phone: "required" });
  });

  it("refuses a set from another company", async () => {
    supabase.queue("company_question_sets", { data: [], error: null });
    expect(await execTool(tools.applyQuestionSet, { jobPostId: JOB.id, questionSetId: SET_ID })).toEqual({
      error: "That question set isn't in your company.",
    });
    expect(upsertJobPosting).not.toHaveBeenCalled();
  });
});

describe("saveQuestionSet tool", () => {
  it("needs exactly one of a job or a form", async () => {
    expect((await validateInput(tools.saveQuestionSet, { name: "x" })).success).toBe(false);
    expect(
      (await validateInput(tools.saveQuestionSet, { name: "x", jobPostId: JOB.id, applicationForm: SET_FORM })).success,
    ).toBe(false);
  });

  it("saves a copy of a job's form for the session company", async () => {
    supabase.queue("job_postings", {
      data: { ...JOB, application_form: { version: 1, questions: [RELOCATE], standard_fields: {} } },
      error: null,
    });
    supabase.queue("company_question_sets", { data: SET_ROW, error: null });

    const result = await execTool(tools.saveQuestionSet, { name: "Engineering", jobPostId: JOB.id });

    expect(result).toEqual({ id: SET_ID, name: "Engineering", url: `/company/settings/question-sets/${SET_ID}` });
    expect(writeOf("insert")!.chain[0].args[0]).toMatchObject({ company_id: COMPANY_A.id, name: "Engineering" });
  });

  it("refuses a question about a protected characteristic", async () => {
    const form = { ...SET_FORM, questions: [{ ...RELOCATE, label: "Do you have kids?" }] };
    const result = await execTool(tools.saveQuestionSet, { name: "Bad", applicationForm: form });
    expect(result).toMatchObject({ error: expect.stringContaining("family status") });
    expect(writeOf("insert")).toBeUndefined();
  });
});

describe("deleteQuestionSet tool", () => {
  it("deletes a set within the company", async () => {
    supabase.queue("company_question_sets", { data: [SET_ROW], error: null });
    supabase.queue("company_question_sets", { data: null, error: null });

    expect(await execTool(tools.deleteQuestionSet, { questionSetId: SET_ID })).toMatchObject({ deleted: "Engineering" });
    expect(writeOf("delete")!.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });
});

describe("question set tools for a member", () => {
  it("lists and applies sets but can't save or delete them without question_sets.manage", () => {
    const memberTools = createRecruiterTools(
      recruiterToolContext(supabase.client, { user: MEMBER_A.user, company: MEMBER_A.myCompany }),
    );
    expect(memberTools).toHaveProperty("listQuestionSets");
    expect(memberTools).not.toHaveProperty("saveQuestionSet");
    expect(memberTools).not.toHaveProperty("deleteQuestionSet");
  });
});
