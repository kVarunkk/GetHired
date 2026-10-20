import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import {
  agentApplicationInput,
  loadApplicationTarget,
  notReadyReason,
  toAgentAnswers,
  toFormAnswers,
  type ApplicationTarget,
} from "./agent-application";
import { standardAnswerKey, validateAnswers } from "./validate-answers";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const RESUME_ID = "22222222-2222-4222-8222-222222222222";

const FORM: ApplicationForm = {
  version: 1,
  questions: [
    { id: id(1), type: "long_text", label: "Why us?", required: true },
    { id: id(2), type: "yes_no", label: "Can you relocate?", required: true },
    { id: id(3), type: "number", label: "Years of Go?", required: false },
    { id: id(4), type: "multi_select", label: "Stack", required: false, options: ["Go", "Rust", "TS"] },
    { id: id(5), type: "single_select", label: "Level", required: false, options: ["Mid", "Senior"] },
  ],
  standard_fields: { expected_salary: "optional", earliest_start_date: "optional" },
};

describe("toFormAnswers", () => {
  it("turns the model's text answers into the form's typed answers", () => {
    const answers = toFormAnswers(FORM, [
      { key: id(1), value: "  The mission " },
      { key: id(2), value: "Yes" },
      { key: id(3), value: "1,200" },
      { key: id(4), choices: ["Go", "TS"] },
      { key: id(5), value: "Senior" },
      { key: standardAnswerKey("expected_salary"), value: "1,500,000 inr" },
      { key: standardAnswerKey("earliest_start_date"), value: "" },
    ]);

    expect(answers).toEqual({
      [id(1)]: "The mission",
      [id(2)]: true,
      [id(3)]: 1200,
      [id(4)]: ["Go", "TS"],
      [id(5)]: "Senior",
      [standardAnswerKey("expected_salary")]: { amount: 1500000, currency: "INR" },
    });
    expect(validateAnswers(FORM, answers).ok).toBe(true);
  });

  it("passes values that don't parse on, so validation gives the field's own message", () => {
    const answers = toFormAnswers(FORM, [
      { key: id(1), value: "x" },
      { key: id(2), value: "maybe" },
      { key: id(3), value: "lots" },
    ]);
    const checked = validateAnswers(FORM, answers);

    expect(checked).toEqual({
      ok: false,
      fieldErrors: { [id(2)]: "Answer yes or no.", [id(3)]: "Enter a number." },
    });
  });

  it("keeps unknown keys, so validation rejects them", () => {
    const answers = toFormAnswers(FORM, [{ key: "made-up", value: "x" }]);
    expect(validateAnswers(FORM, answers)).toMatchObject({ ok: false, formError: expect.any(String) });
  });
});

describe("toAgentAnswers", () => {
  it("writes typed answers in the model's text format", () => {
    expect(
      toAgentAnswers({
        a: "https://x.dev",
        b: true,
        c: { amount: 10, currency: "USD" },
        d: ["Go"],
        e: 3,
      }),
    ).toEqual([
      { key: "a", value: "https://x.dev" },
      { key: "b", value: "yes" },
      { key: "c", value: "10 USD" },
      { key: "d", choices: ["Go"] },
      { key: "e", value: "3" },
    ]);
  });
});

describe("agentApplicationInput", () => {
  it("needs a job id and answers; the resume is optional", () => {
    expect(agentApplicationInput.safeParse({ jobId: JOB_ID, answers: [] }).success).toBe(true);
    expect(agentApplicationInput.safeParse({ jobId: "nope", answers: [] }).success).toBe(false);
  });
});

describe("loadApplicationTarget", () => {
  let supabase: SupabaseMock;
  beforeEach(() => {
    supabase = createSupabaseMock();
  });

  const queueJob = (overrides: Record<string, unknown> = {}) => {
    supabase.queue("all_jobs", {
      data: { id: JOB_ID, job_name: "Engineer", company_name: "Acme", is_platform_job: true },
      error: null,
    });
    supabase.queue("job_postings", {
      data: {
        status: "active",
        questions: [],
        application_form: {
          ...FORM,
          questions: [{ ...FORM.questions[1], knockout: { fail_if: { kind: "equals", value: false }, action: "reject" } }],
        },
        ...overrides,
      },
      error: null,
    });
  };

  it("loads the job's public form and the primary resume", async () => {
    queueJob();
    supabase.queue("resumes", { data: { id: RESUME_ID, name: "Main" }, error: null });
    supabase.queue("applications", { data: [], error: null });

    const loaded = await loadApplicationTarget(supabase.client, "u1", { jobId: JOB_ID });

    expect(loaded.ok).toBe(true);
    const target = (loaded as { target: ApplicationTarget }).target;
    expect(target).toMatchObject({
      title: "Engineer",
      company: "Acme",
      open: true,
      alreadyApplied: false,
      resume: { id: RESUME_ID, name: "Main" },
    });
    // AF-SEC-003: rules never reach the agent.
    expect(JSON.stringify(target.form)).not.toContain("knockout");
    expect(supabase.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["is_primary", true] });
    expect(supabase.callsFor("applications")[0].chain).toContainEqual({ method: "eq", args: ["applicant_user_id", "u1"] });
    expect(notReadyReason(target)).toBeNull();
  });

  it("uses the chosen resume, and refuses one that isn't the user's", async () => {
    queueJob();
    supabase.queue("resumes", { data: null, error: null });
    supabase.queue("applications", { data: [], error: null });

    const loaded = await loadApplicationTarget(supabase.client, "u1", { jobId: JOB_ID, resumeId: RESUME_ID });

    expect(loaded).toEqual({ ok: false, error: "Resume not found." });
    expect(supabase.callsFor("resumes")[0].chain).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["user_id", "u1"] },
        { method: "eq", args: ["id", RESUME_ID] },
      ]),
    );
  });

  it("refuses jobs that aren't on GetHired", async () => {
    supabase.queue("all_jobs", {
      data: { id: JOB_ID, job_name: "Engineer", company_name: "Acme", is_platform_job: false },
      error: null,
    });

    const loaded = await loadApplicationTarget(supabase.client, "u1", { jobId: JOB_ID });

    expect(loaded).toMatchObject({ ok: false, error: expect.stringContaining("isn't on GetHired") });
  });

  it("says why a closed, applied-to or resume-less job can't be applied to", async () => {
    queueJob({ status: "inactive" });
    supabase.queue("resumes", { data: null, error: null });
    supabase.queue("applications", { data: [{ id: "a1" }], error: null });

    const loaded = await loadApplicationTarget(supabase.client, "u1", { jobId: JOB_ID });
    const target = (loaded as { target: ApplicationTarget }).target;

    expect(notReadyReason(target)).toBe("This job isn't taking applications.");
    expect(notReadyReason({ ...target, open: true })).toBe("You've already applied to this job.");
    expect(notReadyReason({ ...target, open: true, alreadyApplied: false })).toBe(
      "There's no resume to send. Upload one first.",
    );
  });
});
