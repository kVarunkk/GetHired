import { describe, expect, it } from "vitest";
import type { ApplicationForm } from "./application-form-schema";
import { publicApplicationForm, splitForm, withRules } from "./public-application-form";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FLAG_NO = { fail_if: { kind: "equals" as const, value: false }, action: "flag" as const };

const FORM: ApplicationForm = {
  version: 1,
  questions: [
    { id: id(1), type: "yes_no", label: "Can you relocate?", required: true, knockout: FLAG_NO },
    { id: id(2), type: "short_text", label: "Old", required: true, archived: true },
    { id: id(3), type: "number", label: "Years of Go?", required: false, knockout: { fail_if: { kind: "less_than", value: 2 }, action: "reject" } },
  ],
  standard_fields: { work_authorization: "required" },
  standard_knockouts: { work_authorization: FLAG_NO },
};

describe("public application form (AF-SEC-003, CPT-014)", () => {
  it("strips every knockout rule and archived question, keeping the order", () => {
    const form = publicApplicationForm(FORM);
    expect(JSON.stringify(form)).not.toContain("knockout");
    expect(form.questions.map((q) => q.id)).toEqual([id(1), id(3)]);
    expect(form.standard_fields).toEqual({ work_authorization: "required" });
  });

  it("splits a form into what's stored on the job and the company-only rules", () => {
    const { stored, rules } = splitForm(FORM);
    expect(JSON.stringify(stored)).not.toContain("knockout");
    // Archived questions stay on the job, so the builder knows the ids are taken.
    expect(stored.questions.map((q) => q.id)).toEqual([id(1), id(2), id(3)]);
    expect(rules).toEqual({
      questions: { [id(1)]: FLAG_NO, [id(3)]: FORM.questions[2].knockout },
      standard: { work_authorization: FLAG_NO },
    });
  });

  it("puts the rules back, dropping rules for questions that are gone", () => {
    const { stored, rules } = splitForm(FORM);
    expect(withRules(stored, rules)).toEqual(FORM);
    const fewer = { ...stored, questions: stored.questions.slice(1) };
    expect(withRules(fewer, rules).questions.some((q) => q.knockout)).toBe(true);
    expect(withRules(fewer, rules).questions.find((q) => q.id === id(1))).toBeUndefined();
  });

  it("ignores malformed stored rules", () => {
    const { stored } = splitForm(FORM);
    expect(withRules(stored, { questions: { [id(1)]: "nope" } })).toEqual({ ...stored, standard_knockouts: undefined });
    expect(withRules(stored, null)).toEqual({ ...stored, standard_knockouts: undefined });
  });
});
