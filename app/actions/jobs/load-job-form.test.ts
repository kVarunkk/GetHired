import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { HIRING_MANAGER_A, JOB_A1, JOB_A2, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { loadJobFormAction } from "./load-job-form";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FORM = {
  version: 1,
  questions: [
    { id: id(7), type: "yes_no", label: "Relocate?", required: true },
    { id: id(8), type: "short_text", label: "Nickname", required: false },
  ],
  standard_fields: { phone: "optional" },
};
const RULE = { fail_if: { kind: "equals", value: false }, action: "flag" };

let db: SupabaseMock;

async function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signInAs(OWNER_A);
});

describe("loadJobFormAction (AF-REQ-005)", () => {
  it("returns the form with its rules and the answered question ids", async () => {
    db.queue("job_postings", { data: jobPostingOf(COMPANY_A, { id: JOB_A1, application_form: FORM }), error: null });
    db.queue("job_posting_form_rules", { data: { rules: { questions: { [id(7)]: RULE }, standard: {} } }, error: null });
    db.queue("applications", {
      data: [{ answers: [], answers_v2: { [id(7)]: true, "std:phone": "1" } }, { answers: ["old"], answers_v2: null }],
      error: null,
    });

    const result = await loadJobFormAction({ jobPostId: JOB_A1 });

    expect(result).toEqual({
      ok: true,
      form: {
        ...FORM,
        questions: [{ ...FORM.questions[0], knockout: RULE }, FORM.questions[1]],
        standard_knockouts: undefined,
      },
      answeredQuestionIds: [id(7), id(1)],
    });
    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("needs jobs.edit on the job", async () => {
    await signInAs(HIRING_MANAGER_A);
    const result = await loadJobFormAction({ jobPostId: JOB_A2 });
    expect(result).toMatchObject({ ok: false });
    expect(db.callsFor("job_postings")).toHaveLength(0);
  });

  it("is not found for another company's job", async () => {
    db.queue("job_postings", { data: null, error: null });
    expect(await loadJobFormAction({ jobPostId: JOB_A1 })).toEqual({ ok: false, error: "Job post not found." });
  });
});
