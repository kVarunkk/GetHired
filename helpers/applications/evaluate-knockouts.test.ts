import { describe, expect, it } from "vitest";
import type { ApplicationForm, FormQuestion, KnockoutRule } from "@/helpers/jobs/application-form-schema";
import { evaluateKnockouts } from "./evaluate-knockouts";
import { standardAnswerKey } from "./validate-answers";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const flag = (fail_if: KnockoutRule["fail_if"]): KnockoutRule => ({ fail_if, action: "flag" });
const reject = (fail_if: KnockoutRule["fail_if"]): KnockoutRule => ({ fail_if, action: "reject" });

function formOf(questions: Partial<FormQuestion>[], extra: Partial<ApplicationForm> = {}): ApplicationForm {
  return {
    version: 1,
    questions: questions.map((q, i) => ({ id: id(i + 1), type: "yes_no", label: `Q${i + 1}`, required: true, ...q }) as FormQuestion),
    standard_fields: {},
    ...extra,
  };
}

describe("evaluateKnockouts (AF-REQ-003)", () => {
  it("passes when no rule fails", () => {
    const form = formOf([{ knockout: flag({ kind: "equals", value: false }) }]);
    expect(evaluateKnockouts(form, { [id(1)]: true })).toEqual({ failed: false, reasons: [], action: "none" });
  });

  it("flags a yes/no answer that fails", () => {
    const form = formOf([{ label: "Can you relocate?", knockout: flag({ kind: "equals", value: false }) }]);
    expect(evaluateKnockouts(form, { [id(1)]: false })).toEqual({
      failed: true,
      action: "flagged",
      reasons: [{ question_id: id(1), label: "Can you relocate?", rule: { kind: "equals", value: false } }],
    });
  });

  it("checks any-of on single and multi select", () => {
    const form = formOf([
      { type: "single_select", options: ["A", "B"], knockout: flag({ kind: "any_of", options: ["B"] }) },
      { type: "multi_select", options: ["X", "Y", "Z"], knockout: flag({ kind: "any_of", options: ["Z"] }) },
    ]);
    expect(evaluateKnockouts(form, { [id(1)]: "A", [id(2)]: ["X", "Y"] }).failed).toBe(false);
    expect(evaluateKnockouts(form, { [id(1)]: "B", [id(2)]: ["X"] }).reasons.map((r) => r.question_id)).toEqual([id(1)]);
    expect(evaluateKnockouts(form, { [id(1)]: "A", [id(2)]: ["Y", "Z"] }).reasons.map((r) => r.question_id)).toEqual([id(2)]);
  });

  it("checks number bounds", () => {
    const form = formOf([
      { type: "number", knockout: flag({ kind: "less_than", value: 2 }) },
      { type: "number", knockout: flag({ kind: "greater_than", value: 90 }) },
    ]);
    expect(evaluateKnockouts(form, { [id(1)]: 2, [id(2)]: 90 }).failed).toBe(false);
    expect(evaluateKnockouts(form, { [id(1)]: 1, [id(2)]: 91 }).reasons).toHaveLength(2);
  });

  it("doesn't fail a skipped optional question", () => {
    const form = formOf([{ required: false, knockout: flag({ kind: "equals", value: false }) }]);
    expect(evaluateKnockouts(form, {}).failed).toBe(false);
  });

  it("ignores rules on archived questions", () => {
    const form = formOf([{ archived: true, knockout: flag({ kind: "equals", value: false }) }]);
    expect(evaluateKnockouts(form, { [id(1)]: false }).failed).toBe(false);
  });

  it("rejects when any failing rule rejects", () => {
    const form = formOf([
      { knockout: flag({ kind: "equals", value: false }) },
      { knockout: reject({ kind: "equals", value: false }) },
    ]);
    expect(evaluateKnockouts(form, { [id(1)]: false, [id(2)]: false }).action).toBe("rejected");
    expect(evaluateKnockouts(form, { [id(1)]: false, [id(2)]: true }).action).toBe("flagged");
  });

  it("checks the work authorisation standard field", () => {
    const form = formOf([], {
      standard_fields: { work_authorization: "required" },
      standard_knockouts: { work_authorization: reject({ kind: "equals", value: false }) },
    });
    expect(evaluateKnockouts(form, { [standardAnswerKey("work_authorization")]: false })).toEqual({
      failed: true,
      action: "rejected",
      reasons: [
        {
          question_id: standardAnswerKey("work_authorization"),
          label: "Are you authorised to work in this job's locations?",
          rule: { kind: "equals", value: false },
        },
      ],
    });
  });

  it("ignores a standard knockout whose field is off", () => {
    const form = formOf([], { standard_knockouts: { work_authorization: flag({ kind: "equals", value: false }) } });
    expect(evaluateKnockouts(form, { [standardAnswerKey("work_authorization")]: false }).failed).toBe(false);
  });
});
