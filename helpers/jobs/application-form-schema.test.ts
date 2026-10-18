import { describe, expect, it } from "vitest";
import {
  MAX_FORM_QUESTIONS,
  STANDARD_FIELDS,
  applicationFormSchema,
  emptyApplicationForm,
  formFromLegacyQuestions,
  legacyQuestionsOf,
  type ApplicationForm,
  type FormQuestion,
} from "./application-form-schema";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const q = (overrides: Partial<FormQuestion> = {}): FormQuestion =>
  ({ id: id(1), type: "short_text", label: "Your name?", required: true, ...overrides }) as FormQuestion;

const form = (questions: unknown[], extra: Partial<ApplicationForm> = {}) => ({
  version: 1,
  questions,
  standard_fields: {},
  ...extra,
});

const ok = (value: unknown) => applicationFormSchema.safeParse(value).success;
const firstError = (value: unknown) => {
  const r = applicationFormSchema.safeParse(value);
  return r.success ? null : r.error.issues[0]?.message;
};

describe("applicationFormSchema (AF-REQ-001)", () => {
  it("accepts the empty form", () => {
    expect(ok(emptyApplicationForm())).toBe(true);
  });

  it("accepts one question of each type with valid settings", () => {
    expect(
      ok(
        form([
          q({ id: id(1), type: "short_text", min_length: 2, max_length: 100 }),
          q({ id: id(2), type: "long_text", help_text: "A few lines." }),
          q({ id: id(3), type: "single_select", options: ["A", "B"] }),
          q({ id: id(4), type: "multi_select", options: ["A", "B", "C"], min_selected: 1, max_selected: 2 }),
          q({ id: id(5), type: "yes_no" }),
          q({ id: id(6), type: "number", min: 0, max: 10, integer: true }),
          q({ id: id(7), type: "date", date_rule: "future" }),
          q({ id: id(8), type: "url", required: false }),
        ]),
      ),
    ).toBe(true);
  });

  it(`allows at most ${MAX_FORM_QUESTIONS} questions`, () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => q({ id: id(i + 1) }));
    expect(ok(form(many(MAX_FORM_QUESTIONS)))).toBe(true);
    expect(firstError(form(many(MAX_FORM_QUESTIONS + 1)))).toBe(`You can add at most ${MAX_FORM_QUESTIONS} questions.`);
  });

  it.each([
    ["a 301-character label", q({ label: "x".repeat(301) })],
    ["an empty label", q({ label: "  " })],
    ["501 characters of help", q({ help_text: "x".repeat(501) })],
    ["a select with one option", q({ type: "single_select", options: ["Only"] })],
    ["a select with 31 options", q({ type: "single_select", options: Array.from({ length: 31 }, (_, i) => `O${i}`) })],
    ["a select with a 121-character option", q({ type: "single_select", options: ["A", "x".repeat(121)] })],
    ["a select with duplicate options", q({ type: "single_select", options: ["A", "a"] })],
    ["a select without options", q({ type: "single_select" })],
    ["min above max", q({ type: "number", min: 5, max: 1 })],
    ["min_length above max_length", q({ min_length: 10, max_length: 5 })],
    ["max_selected above the options", q({ type: "multi_select", options: ["A", "B"], max_selected: 3 })],
    ["min_selected above max_selected", q({ type: "multi_select", options: ["A", "B", "C"], min_selected: 3, max_selected: 2 })],
    ["options on a text question", q({ type: "short_text", options: ["A", "B"] })],
    ["a non-uuid id", q({ id: "q1" })],
    ["an unknown type", q({ type: "file" as never })],
    ["an unknown key", { ...q(), weight: 3 }],
  ])("rejects %s", (_, question) => {
    expect(ok(form([question]))).toBe(false);
  });

  it("rejects duplicate question ids", () => {
    expect(firstError(form([q({ id: id(1) }), q({ id: id(1), label: "Again?" })]))).toBe("Each question needs its own id.");
  });

  describe("knockout rules (AF-REQ-003)", () => {
    it.each([
      ["yes/no", q({ type: "yes_no", knockout: { fail_if: { kind: "equals", value: false }, action: "flag" } })],
      ["single select", q({ type: "single_select", options: ["A", "B"], knockout: { fail_if: { kind: "any_of", options: ["B"] }, action: "reject" } })],
      ["multi select", q({ type: "multi_select", options: ["A", "B"], knockout: { fail_if: { kind: "any_of", options: ["A"] }, action: "flag" } })],
      ["number", q({ type: "number", knockout: { fail_if: { kind: "less_than", value: 2 }, action: "flag" } })],
    ])("allows a rule on %s", (_, question) => {
      expect(ok(form([question]))).toBe(true);
    });

    it.each([
      ["a text question", q({ knockout: { fail_if: { kind: "equals", value: false }, action: "flag" } })],
      ["a rule that doesn't fit the type", q({ type: "yes_no", knockout: { fail_if: { kind: "less_than", value: 1 }, action: "flag" } })],
      ["an option that isn't in the list", q({ type: "single_select", options: ["A", "B"], knockout: { fail_if: { kind: "any_of", options: ["C"] }, action: "flag" } })],
    ])("rejects a rule on %s", (_, question) => {
      expect(ok(form([question]))).toBe(false);
    });

    it("allows a rule on the work authorisation standard field only", () => {
      const rule = { fail_if: { kind: "equals", value: false }, action: "flag" };
      expect(ok(form([], { standard_fields: { work_authorization: "required" }, standard_knockouts: { work_authorization: rule } } as never))).toBe(true);
      expect(ok(form([], { standard_knockouts: { phone: rule } } as never))).toBe(false);
    });
  });

  it("validates standard field toggles", () => {
    expect(ok(form([], { standard_fields: { phone: "optional", cover_letter: "required", linkedin_url: "off" } }))).toBe(true);
    expect(ok(form([], { standard_fields: { phone: "sometimes" } } as never))).toBe(false);
    expect(ok(form([], { standard_fields: { shoe_size: "required" } } as never))).toBe(false);
  });

  it("describes every standard field, none about a protected characteristic (AF-SEC-001)", () => {
    expect(Object.keys(STANDARD_FIELDS)).toEqual([
      "phone",
      "linkedin_url",
      "portfolio_url",
      "current_location",
      "expected_salary",
      "notice_period_days",
      "earliest_start_date",
      "work_authorization",
      "cover_letter",
    ]);
  });
});

describe("legacy questions (AF-CON-001, AF-DEC-003)", () => {
  it("turns string questions into required long-text questions with stable ids", () => {
    const a = formFromLegacyQuestions(["Why us?", "Notice?"]);
    const b = formFromLegacyQuestions(["Why us?", "Notice?"]);
    expect(a).toEqual(b);
    expect(a.questions.map((x) => [x.type, x.label, x.required])).toEqual([
      ["long_text", "Why us?", true],
      ["long_text", "Notice?", true],
    ]);
    expect(ok(a)).toBe(true);
  });

  it("drops empty legacy questions", () => {
    expect(formFromLegacyQuestions(["", " ", "Why?"]).questions).toHaveLength(1);
  });

  it("keeps old clients working with the labels of required, live text questions", () => {
    const f = form([
      q({ id: id(1), label: "Name?" }),
      q({ id: id(2), type: "long_text", label: "Why?" }),
      q({ id: id(3), type: "long_text", label: "Optional?", required: false }),
      q({ id: id(4), type: "yes_no", label: "Authorised?" }),
      q({ id: id(5), label: "Old?", archived: true }),
    ]) as ApplicationForm;
    expect(legacyQuestionsOf(f)).toEqual(["Name?", "Why?"]);
  });
});
