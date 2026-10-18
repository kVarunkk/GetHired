import { describe, expect, it } from "vitest";
import type { ApplicationForm, FormQuestion } from "@/helpers/jobs/application-form-schema";
import { standardAnswerKey, validateAnswers } from "./validate-answers";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TODAY = "2026-10-17";

function formOf(questions: Partial<FormQuestion>[], standard: ApplicationForm["standard_fields"] = {}): ApplicationForm {
  return {
    version: 1,
    questions: questions.map((q, i) => ({ id: id(i + 1), type: "short_text", label: `Q${i + 1}`, required: true, ...q }) as FormQuestion),
    standard_fields: standard,
  };
}

const check = (form: ApplicationForm, answers: unknown) => validateAnswers(form, answers, { today: TODAY });
const errorFor = (form: ApplicationForm, answers: unknown, key = id(1)) => {
  const r = check(form, answers);
  return r.ok ? null : r.fieldErrors[key];
};

describe("validateAnswers (AF-REQ-007)", () => {
  it("accepts valid answers of every type and returns them normalised", () => {
    const form = formOf([
      { type: "short_text" },
      { type: "long_text" },
      { type: "single_select", options: ["A", "B"] },
      { type: "multi_select", options: ["A", "B", "C"] },
      { type: "yes_no" },
      { type: "number" },
      { type: "date" },
      { type: "url" },
    ]);
    const r = check(form, {
      [id(1)]: "  Ada  ",
      [id(2)]: "Long answer",
      [id(3)]: "B",
      [id(4)]: ["A", "C"],
      [id(5)]: false,
      [id(6)]: 4,
      [id(7)]: "2026-12-01",
      [id(8)]: "https://ada.dev",
    });
    expect(r).toEqual({
      ok: true,
      answers: {
        [id(1)]: "Ada",
        [id(2)]: "Long answer",
        [id(3)]: "B",
        [id(4)]: ["A", "C"],
        [id(5)]: false,
        [id(6)]: 4,
        [id(7)]: "2026-12-01",
        [id(8)]: "https://ada.dev",
      },
    });
  });

  it("requires required questions and leaves skipped optional ones out", () => {
    const form = formOf([{ required: true }, { required: false }]);
    expect(errorFor(form, {})).toBe("This question is required.");
    expect(errorFor(form, { [id(1)]: "   " })).toBe("This question is required.");
    expect(check(form, { [id(1)]: "Yes", [id(2)]: "" })).toEqual({ ok: true, answers: { [id(1)]: "Yes" } });
  });

  it("rejects answers to unknown or archived questions", () => {
    const form = formOf([{}, { archived: true }]);
    expect(check(form, { [id(1)]: "a", [id(9)]: "x" })).toMatchObject({ ok: false, formError: "Some answers don't match this job's questions." });
    expect(check(form, { [id(1)]: "a", [id(2)]: "x" })).toMatchObject({ ok: false });
  });

  it("ignores archived questions when checking required ones", () => {
    expect(check(formOf([{}, { archived: true }]), { [id(1)]: "a" })).toEqual({ ok: true, answers: { [id(1)]: "a" } });
  });

  it("checks text lengths, with type defaults", () => {
    expect(errorFor(formOf([{ min_length: 3 }]), { [id(1)]: "ab" })).toBe("Use at least 3 characters.");
    expect(errorFor(formOf([{ max_length: 5 }]), { [id(1)]: "abcdef" })).toBe("Use at most 5 characters.");
    expect(errorFor(formOf([{ type: "short_text" }]), { [id(1)]: "x".repeat(301) })).toBe("Use at most 300 characters.");
    expect(errorFor(formOf([{ type: "long_text" }]), { [id(1)]: "x".repeat(5001) })).toBe("Use at most 5000 characters.");
  });

  it("checks choices", () => {
    const single = formOf([{ type: "single_select", options: ["A", "B"] }]);
    expect(errorFor(single, { [id(1)]: "C" })).toBe("Pick one of the options.");
    const multi = formOf([{ type: "multi_select", options: ["A", "B", "C"], min_selected: 2, max_selected: 2 }]);
    expect(errorFor(multi, { [id(1)]: ["A"] })).toBe("Pick at least 2.");
    expect(errorFor(multi, { [id(1)]: ["A", "B", "C"] })).toBe("Pick at most 2.");
    expect(errorFor(multi, { [id(1)]: ["A", "Z"] })).toBe("Pick from the options.");
    expect(errorFor(multi, { [id(1)]: ["A", "A"] })).toBe("Pick each option once.");
    expect(errorFor(formOf([{ type: "multi_select", options: ["A", "B"] }]), { [id(1)]: [] })).toBe("This question is required.");
  });

  it("checks yes/no as a boolean", () => {
    expect(errorFor(formOf([{ type: "yes_no" }]), { [id(1)]: "yes" })).toBe("Answer yes or no.");
  });

  it("checks numbers", () => {
    const form = formOf([{ type: "number", min: 1, max: 10, integer: true }]);
    expect(errorFor(form, { [id(1)]: 0 })).toBe("Enter at least 1.");
    expect(errorFor(form, { [id(1)]: 11 })).toBe("Enter at most 10.");
    expect(errorFor(form, { [id(1)]: 2.5 })).toBe("Enter a whole number.");
    expect(errorFor(form, { [id(1)]: "3" })).toBe("Enter a number.");
  });

  it("checks dates", () => {
    expect(errorFor(formOf([{ type: "date" }]), { [id(1)]: "17/10/2026" })).toBe("Enter a valid date.");
    expect(errorFor(formOf([{ type: "date" }]), { [id(1)]: "2026-02-30" })).toBe("Enter a valid date.");
    expect(errorFor(formOf([{ type: "date", date_rule: "future" }]), { [id(1)]: "2026-10-16" })).toBe("Pick a date from today on.");
    expect(check(formOf([{ type: "date", date_rule: "future" }]), { [id(1)]: TODAY }).ok).toBe(true);
    const ranged = formOf([{ type: "date", date_rule: { min: "2026-11-01", max: "2026-12-31" } }]);
    expect(errorFor(ranged, { [id(1)]: "2026-10-31" })).toBe("Pick a date on or after 2026-11-01.");
    expect(errorFor(ranged, { [id(1)]: "2027-01-01" })).toBe("Pick a date on or before 2026-12-31.");
  });

  it("only accepts http(s) links (AF-SEC-002)", () => {
    const form = formOf([{ type: "url" }]);
    expect(errorFor(form, { [id(1)]: "javascript:alert(1)" })).toBe("Enter a link starting with http:// or https://.");
    expect(errorFor(form, { [id(1)]: "ada.dev" })).toBe("Enter a link starting with http:// or https://.");
  });

  describe("standard fields (AF-REQ-002)", () => {
    const phone = standardAnswerKey("phone");
    const salary = standardAnswerKey("expected_salary");
    const auth = standardAnswerKey("work_authorization");

    it("follows the toggles: off fields are rejected, required ones enforced", () => {
      const form = formOf([], { phone: "required", cover_letter: "optional" });
      expect(errorFor(form, {}, phone)).toBe("This question is required.");
      expect(check(form, { [phone]: "+91 98765 43210" })).toEqual({ ok: true, answers: { [phone]: "+91 98765 43210" } });
      expect(check(form, { [phone]: "1", [standardAnswerKey("linkedin_url")]: "https://linkedin.com/in/ada" })).toMatchObject({ ok: false });
    });

    it("validates salary as an amount and a currency", () => {
      const form = formOf([], { expected_salary: "required" });
      expect(check(form, { [salary]: { amount: 1500000, currency: "INR" } }).ok).toBe(true);
      expect(errorFor(form, { [salary]: { amount: -1, currency: "INR" } }, salary)).toBe("Enter an amount of 0 or more.");
      expect(errorFor(form, { [salary]: 100 }, salary)).toBe("Enter an amount and a currency.");
    });

    it("only accepts an earliest start date from today on", () => {
      const start = standardAnswerKey("earliest_start_date");
      const form = formOf([], { earliest_start_date: "required" });
      expect(errorFor(form, { [start]: "2026-10-16" }, start)).toBe("Pick a date from today on.");
      expect(check(form, { [start]: TODAY }).ok).toBe(true);
    });

    it("only accepts a notice period of whole days, 0 or more", () => {
      const notice = standardAnswerKey("notice_period_days");
      const form = formOf([], { notice_period_days: "required" });
      expect(errorFor(form, { [notice]: -5 }, notice)).toBe("Enter at least 0.");
      expect(errorFor(form, { [notice]: 2.5 }, notice)).toBe("Enter a whole number.");
      expect(check(form, { [notice]: 0 }).ok).toBe(true);
    });

    it("validates work authorisation as yes/no", () => {
      const form = formOf([], { work_authorization: "required" });
      expect(check(form, { [auth]: true }).ok).toBe(true);
      expect(errorFor(form, { [auth]: "no" }, auth)).toBe("Answer yes or no.");
    });
  });

  it("rejects input that isn't an object", () => {
    expect(check(formOf([]), "answers")).toMatchObject({ ok: false });
    expect(check(formOf([]), ["a"])).toMatchObject({ ok: false });
  });
});
