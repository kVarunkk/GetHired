import {
  STANDARD_FIELDS,
  liveQuestions,
  type ApplicationForm,
  type KnockoutCondition,
  type KnockoutRule,
} from "@/helpers/jobs/application-form-schema";
import { standardAnswerKey, type AnswerValue, type Answers } from "./validate-answers";

// AF-REQ-003. Which knockout rules an application fails. Runs on the server
// only, on answers validateAnswers has already checked. Applicants never see
// the result (AF-SEC-003).

export type KnockoutReason = { question_id: string; label: string; rule: KnockoutCondition };
export type KnockoutResult = {
  failed: boolean;
  reasons: KnockoutReason[];
  action: "none" | "flagged" | "rejected";
};

function fails(condition: KnockoutCondition, value: AnswerValue | undefined): boolean {
  if (value === undefined) return false; // a skipped optional question can't fail
  switch (condition.kind) {
    case "equals":
      return value === condition.value;
    case "any_of": {
      const picked = Array.isArray(value) ? value : [value];
      return picked.some((v) => typeof v === "string" && condition.options.includes(v));
    }
    case "less_than":
      return typeof value === "number" && value < condition.value;
    case "greater_than":
      return typeof value === "number" && value > condition.value;
  }
}

export function evaluateKnockouts(form: ApplicationForm, answers: Answers): KnockoutResult {
  const checks: { key: string; label: string; rule: KnockoutRule }[] = [];
  for (const q of liveQuestions(form)) {
    if (q.knockout) checks.push({ key: q.id, label: q.label, rule: q.knockout });
  }
  const workAuth = form.standard_knockouts?.work_authorization;
  const workAuthMode = form.standard_fields.work_authorization;
  if (workAuth && workAuthMode && workAuthMode !== "off") {
    checks.push({
      key: standardAnswerKey("work_authorization"),
      label: STANDARD_FIELDS.work_authorization.label,
      rule: workAuth,
    });
  }

  const failing = checks.filter((c) => fails(c.rule.fail_if, answers[c.key]));
  if (failing.length === 0) return { failed: false, reasons: [], action: "none" };
  return {
    failed: true,
    reasons: failing.map((c) => ({ question_id: c.key, label: c.label, rule: c.rule.fail_if })),
    action: failing.some((c) => c.rule.action === "reject") ? "rejected" : "flagged",
  };
}
