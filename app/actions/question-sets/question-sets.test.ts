import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { ADMIN_A, MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { applyQuestionSet, copyQuestionSet } from "@/helpers/jobs/question-sets";
import { listQuestionSetsAction } from "./list-question-sets";
import { saveQuestionSetAction } from "./save-question-set";
import { deleteQuestionSetAction } from "./delete-question-set";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SET_ID = "5e000000-0000-4000-8000-000000000001";
const FORM = {
  version: 1 as const,
  questions: [
    { id: id(1), type: "yes_no" as const, label: "Can you relocate?", required: true },
    { id: id(2), type: "short_text" as const, label: "Old", required: true, archived: true },
  ],
  standard_fields: { phone: "optional" as const },
};
const ROW = { id: SET_ID, name: "Engineering", form: { ...FORM, questions: [FORM.questions[0]] }, updated_at: "2026-10-17T00:00:00Z" };

let db: SupabaseMock;
async function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}
const writeOf = (method: string) =>
  db.callsFor("company_question_sets").find((c) => c.chain.some((m) => m.method === method));

beforeEach(async () => {
  vi.clearAllMocks();
  await signInAs(OWNER_A);
});

describe("question set actions (AF-REQ-004, CPT-034)", () => {
  it("lists the company's sets, with whether the caller can manage them", async () => {
    await signInAs(MEMBER_A);
    db.queue("company_question_sets", { data: [ROW, { ...ROW, id: id(9), form: { broken: true } }], error: null });

    expect(await listQuestionSetsAction()).toEqual({
      ok: true,
      canManage: false,
      sets: [{ id: SET_ID, name: "Engineering", form: ROW.form, updatedAt: ROW.updated_at }],
    });
    expect(db.callsFor("company_question_sets")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("saves a new set for the session company, without archived questions", async () => {
    await signInAs(ADMIN_A);
    db.queue("company_question_sets", { data: ROW, error: null });

    const result = await saveQuestionSetAction({ name: " Engineering ", form: FORM });

    expect(result).toMatchObject({ ok: true, set: { id: SET_ID, name: "Engineering" } });
    expect(writeOf("insert")!.chain[0].args[0]).toEqual({
      company_id: COMPANY_A.id,
      name: "Engineering",
      form: { ...FORM, questions: [FORM.questions[0]] },
    });
  });

  it("overwrites a set by id within the company", async () => {
    db.queue("company_question_sets", { data: ROW, error: null });
    await saveQuestionSetAction({ id: SET_ID, name: "Engineering", form: FORM });
    const update = writeOf("update")!.chain;
    expect(update).toContainEqual({ method: "eq", args: ["id", SET_ID] });
    expect(update).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it.each([
    ["a taken name", { code: "23505", message: "duplicate" }, "A set with this name already exists."],
    ["the 26th set", { code: "P0001", message: "QUESTION_SET_LIMIT" }, "You can keep up to 25 question sets."],
  ])("maps %s", async (_, error, message) => {
    db.queue("company_question_sets", { data: null, error });
    expect(await saveQuestionSetAction({ name: "Engineering", form: FORM })).toEqual({ ok: false, error: message });
  });

  it("refuses a question about a protected characteristic", async () => {
    const form = { ...FORM, questions: [{ id: id(3), type: "yes_no" as const, label: "Do you have kids?", required: true }] };
    const result = await saveQuestionSetAction({ name: "Bad", form });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("family status") });
    expect(writeOf("insert")).toBeUndefined();
  });

  it("needs question_sets.manage to save or delete", async () => {
    await signInAs(MEMBER_A);
    expect(await saveQuestionSetAction({ name: "x", form: FORM })).toEqual({
      ok: false,
      error: "Your role can't manage question sets.",
    });
    expect(await deleteQuestionSetAction({ id: SET_ID })).toMatchObject({ ok: false });
    expect(db.callsFor("company_question_sets")).toHaveLength(0);
  });

  it("deletes a set within the company", async () => {
    db.queue("company_question_sets", { data: null, error: null });
    expect(await deleteQuestionSetAction({ id: SET_ID })).toEqual({ ok: true });
    expect(writeOf("delete")!.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });
});

describe("copyQuestionSet", () => {
  it("copies the set with fresh ids, so later edits to the set don't touch the job", () => {
    let n = 100;
    const copy = copyQuestionSet(FORM, () => id(n++));
    expect(copy.questions).toEqual([{ ...FORM.questions[0], id: id(100) }]);
    expect(copy.standard_fields).toEqual(FORM.standard_fields);
    expect(copy.standard_fields).not.toBe(FORM.standard_fields);
  });
});

describe("applyQuestionSet (AF-REQ-005)", () => {
  it("replaces the questions and keeps answered ones archived", () => {
    const current = {
      version: 1 as const,
      questions: [
        { id: id(7), type: "short_text" as const, label: "Answered", required: true },
        { id: id(8), type: "short_text" as const, label: "Unanswered", required: true },
      ],
      standard_fields: {},
    };
    const copy = copyQuestionSet(FORM, () => id(200));
    const result = applyQuestionSet(current, copy, [id(7)]);
    expect(result.questions.map((q) => [q.id, q.archived ?? false])).toEqual([
      [id(200), false],
      [id(7), true],
    ]);
    expect(result.standard_fields).toEqual(FORM.standard_fields);
  });
});
