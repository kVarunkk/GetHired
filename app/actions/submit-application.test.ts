import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT, jobPostingOf } from "@/test/utils/recruiter";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { standardAnswerKey } from "@/helpers/applications/validate-answers";
import { rejectForKnockout } from "@/helpers/applications/knockout-reject";
import { submitApplicationAction } from "./submit-application";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/ai/deduct-user-credits", () => ({ deductUserCreditsHelper: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/app/actions/revalidate-tag", () => ({ revalidateCacheAction: vi.fn() }));
vi.mock("@/helpers/applications/knockout-reject", () => ({
  KNOCKOUT_EMAIL_DELAY_MS: 86_400_000,
  rejectForKnockout: vi.fn(),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RESUME_ID = "r0000000-0000-4000-8000-000000000001".replace("r", "f");
const APPLICATION_ID = "e0000000-0000-4000-8000-0000000000aa";

const FORM: ApplicationForm = {
  version: 1,
  questions: [
    { id: id(1), type: "long_text", label: "Why us?", required: true },
    { id: id(2), type: "yes_no", label: "Can you relocate?", required: true },
    { id: id(3), type: "short_text", label: "Nickname?", required: false },
  ],
  standard_fields: { work_authorization: "required" },
};
const RULES = { questions: { [id(2)]: { fail_if: { kind: "equals", value: false }, action: "flag" } }, standard: {} };

const JOB = jobPostingOf(COMPANY_A, { status: "active", application_form: FORM, questions: ["Why us?"] });
const ANSWERS = { [id(1)]: "The mission", [id(2)]: true, [standardAnswerKey("work_authorization")]: true };
const INPUT = { allJobsId: JOB.job_id!, resumeId: RESUME_ID, answers: ANSWERS };

let user: SupabaseMock;
let service: SupabaseMock;

function queueHappyPath({ job = JOB, rules = RULES as unknown, existing = [] as unknown[] } = {}) {
  user.queue("resumes", { data: { id: RESUME_ID }, error: null });
  service.queue("job_postings", { data: job, error: null });
  service.queue("job_posting_form_rules", { data: rules ? { rules } : null, error: null });
  service.queue("applications", { data: existing, error: null });
  user.queue("applications", { data: { id: APPLICATION_ID }, error: null });
  service.queue("application_knockouts", { data: null, error: null });
}

const insertOf = (mock: SupabaseMock, table: string) =>
  mock.callsFor(table).find((c) => c.chain.some((m) => m.method === "insert"))?.chain.find((m) => m.method === "insert")?.args[0];

beforeEach(async () => {
  vi.clearAllMocks();
  user = createSupabaseMock({ user: PUBLIC_APPLICANT.user });
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.mocked(deductUserCreditsHelper).mockResolvedValue(undefined as never);
  await setRequestUser(PUBLIC_APPLICANT.user, user.client);
});

describe("submitApplicationAction (AF-REQ-007, CPT-015)", () => {
  it("validates, writes typed answers, the snapshot and the legacy answers, and charges a credit", async () => {
    queueHappyPath();

    const result = await submitApplicationAction(INPUT);

    expect(result).toEqual({ ok: true, applicationId: APPLICATION_ID, creditsDeducted: true });
    const row = insertOf(user, "applications");
    expect(row).toEqual({
      job_post_id: JOB.id,
      all_jobs_id: JOB.job_id,
      applicant_user_id: PUBLIC_APPLICANT.id,
      resume_id: RESUME_ID,
      status: "submitted",
      answers: ["The mission"],
      answers_v2: ANSWERS,
      form_snapshot: FORM,
      source: "applied",
      source_detail: null,
    });
    // No knockout rule failed: a passing row is still written, for the filter.
    expect(insertOf(service, "application_knockouts")).toEqual({
      application_id: APPLICATION_ID,
      company_id: COMPANY_A.id,
      job_post_id: JOB.id,
      failed: false,
      reasons: [],
      action_taken: "none",
    });
    expect(deductUserCreditsHelper).toHaveBeenCalledWith(user.client, PUBLIC_APPLICANT.id, 1);
    await flushAfter();
    expect(eventCaptureServer).toHaveBeenCalled();
  });

  it("never puts knockout rules in the snapshot the applicant can read (AF-SEC-003)", async () => {
    queueHappyPath();
    await submitApplicationAction(INPUT);
    expect(JSON.stringify(insertOf(user, "applications"))).not.toContain("knockout");
  });

  it("flags a failed knockout without telling the applicant", async () => {
    queueHappyPath();

    const result = await submitApplicationAction({ ...INPUT, answers: { ...ANSWERS, [id(2)]: false } });

    expect(result).toEqual({ ok: true, applicationId: APPLICATION_ID, creditsDeducted: true });
    expect(insertOf(service, "application_knockouts")).toMatchObject({
      failed: true,
      action_taken: "flagged",
      reasons: [{ question_id: id(2), label: "Can you relocate?" }],
    });
  });

  describe("reject rules (AF-DEC-002, CPT-032)", () => {
    const REJECT = { questions: { [id(2)]: { fail_if: { kind: "equals", value: false }, action: "reject" } }, standard: {} };

    it("moves the application to Rejected and schedules the email for 24 hours later", async () => {
      vi.mocked(rejectForKnockout).mockResolvedValue(true);
      queueHappyPath({ rules: REJECT });
      const before = Date.now();

      await submitApplicationAction({ ...INPUT, answers: { ...ANSWERS, [id(2)]: false } });

      expect(rejectForKnockout).toHaveBeenCalledWith(service.client, {
        applicationId: APPLICATION_ID,
        companyId: COMPANY_A.id,
        candidateUserId: PUBLIC_APPLICANT.id,
      });
      const row = insertOf(service, "application_knockouts") as { action_taken: string; reject_email_due_at: string };
      expect(row.action_taken).toBe("rejected");
      const due = new Date(row.reject_email_due_at).getTime();
      expect(due).toBeGreaterThanOrEqual(before + 86_400_000);
      expect(due).toBeLessThan(before + 86_400_000 + 60_000);
    });

    it("only flags when there's no Rejected stage to move to", async () => {
      vi.mocked(rejectForKnockout).mockResolvedValue(false);
      queueHappyPath({ rules: REJECT });

      await submitApplicationAction({ ...INPUT, answers: { ...ANSWERS, [id(2)]: false } });

      expect(insertOf(service, "application_knockouts")).toMatchObject({ action_taken: "flagged" });
      expect(insertOf(service, "application_knockouts")).not.toHaveProperty("reject_email_due_at");
    });

    it("doesn't move anything when the rules pass", async () => {
      queueHappyPath({ rules: REJECT });
      await submitApplicationAction(INPUT);
      expect(rejectForKnockout).not.toHaveBeenCalled();
    });
  });

  it("returns field errors and writes nothing for invalid answers", async () => {
    queueHappyPath();

    const result = await submitApplicationAction({ ...INPUT, answers: { [id(2)]: "yes" } });

    expect(result).toEqual({
      ok: false,
      error: "Check your answers and try again.",
      fieldErrors: {
        [id(1)]: "This question is required.",
        [id(2)]: "Answer yes or no.",
        [standardAnswerKey("work_authorization")]: "This question is required.",
      },
    });
    expect(insertOf(user, "applications")).toBeUndefined();
    expect(deductUserCreditsHelper).not.toHaveBeenCalled();
  });

  it("uses the legacy questions when a job has no form", async () => {
    queueHappyPath({ job: jobPostingOf(COMPANY_A, { status: "active", questions: ["Why us?"] }), rules: null });

    const result = await submitApplicationAction({ ...INPUT, answers: { [id(1)]: "Because" } });

    expect(result).toMatchObject({ ok: true });
    expect(insertOf(user, "applications")).toMatchObject({ answers: ["Because"], answers_v2: { [id(1)]: "Because" } });
  });

  it("refuses a second application to the same job", async () => {
    queueHappyPath({ existing: [{ id: "e0000000-0000-4000-8000-000000000099" }] });
    expect(await submitApplicationAction(INPUT)).toEqual({ ok: false, error: "You've already applied to this job." });
    expect(insertOf(user, "applications")).toBeUndefined();
  });

  it("refuses a second application that races past the check (unique index)", async () => {
    user.queue("resumes", { data: { id: RESUME_ID }, error: null });
    service.queue("job_postings", { data: JOB, error: null });
    service.queue("job_posting_form_rules", { data: { rules: RULES }, error: null });
    service.queue("applications", { data: [], error: null });
    user.queue("applications", { data: null, error: { code: "23505", message: "duplicate key" } as never });
    expect(await submitApplicationAction(INPUT)).toEqual({ ok: false, error: "You've already applied to this job." });
    expect(insertOf(service, "application_knockouts")).toBeUndefined();
  });

  it("refuses an inactive or unknown job", async () => {
    queueHappyPath({ job: { ...JOB, status: "inactive" } });
    expect(await submitApplicationAction(INPUT)).toEqual({ ok: false, error: "This job isn't taking applications." });

    service.reset();
    user.reset();
    queueHappyPath({ job: null as never });
    expect(await submitApplicationAction(INPUT)).toEqual({ ok: false, error: "This job isn't taking applications." });
  });

  it("refuses a resume that isn't the applicant's", async () => {
    user.queue("resumes", { data: null, error: null });
    expect(await submitApplicationAction(INPUT)).toEqual({ ok: false, error: "Pick one of your resumes." });
    expect(service.callsFor("job_postings")).toHaveLength(0);
  });

  it("refuses company accounts and signed-out users", async () => {
    await setRequestUser(COMPANY_A.user, user.client);
    expect(await submitApplicationAction(INPUT)).toEqual({ ok: false, error: "Sign in with an applicant account to apply." });
    await setRequestUser(null);
    expect(await submitApplicationAction(INPUT)).toEqual({ ok: false, error: "Sign in with an applicant account to apply." });
  });

  it("records a careers-page source and its ref (CP-REQ-013)", async () => {
    queueHappyPath();
    await submitApplicationAction({ ...INPUT, source: "careers_page", ref: "LinkedIn" });
    expect(insertOf(user, "applications")).toMatchObject({ source: "careers_page", source_detail: "linkedin" });
  });

  it.each([
    ["an unknown source", { source: "agent" }],
    ["a bad ref", { ref: "no spaces allowed" }],
    ["an extra field", { applicantUserId: COMPANY_A.user.id }],
    ["a non-uuid job", { allJobsId: "job-1" }],
  ])("rejects %s", async (_, extra) => {
    queueHappyPath();
    expect(await submitApplicationAction({ ...INPUT, ...extra } as never)).toEqual({
      ok: false,
      error: "Something's off with this application. Reload the page and try again.",
    });
  });

  it("still succeeds when the credit can't be charged", async () => {
    queueHappyPath();
    vi.mocked(deductUserCreditsHelper).mockRejectedValue(new Error("no credits"));
    expect(await submitApplicationAction(INPUT)).toEqual({ ok: true, applicationId: APPLICATION_ID, creditsDeducted: false });
  });
});
