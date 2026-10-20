import {
  knockoutRuleSchema,
  type ApplicationForm,
  type KnockoutRule,
} from "./application-form-schema";

// AF-SEC-003. job_postings is world-readable, so a job's knockout rules are
// stored apart from its form (job_posting_form_rules, company-only) and never
// reach an applicant, the public API, MCP or the extension.

export type FormRules = {
  questions: Record<string, KnockoutRule>;
  standard: { work_authorization?: KnockoutRule };
};

/** What applicants see: no knockout rules and no archived questions. */
export function publicApplicationForm(form: ApplicationForm): ApplicationForm {
  return {
    version: 1,
    questions: form.questions
      .filter((q) => !q.archived)
      .map((q) => {
        const { knockout: _knockout, ...rest } = q;
        return rest;
      }),
    standard_fields: { ...form.standard_fields },
  };
}

/** A full form (as the builder edits it) → the job's stored form and its rules. */
export function splitForm(form: ApplicationForm): { stored: ApplicationForm; rules: FormRules } {
  const rules: FormRules = { questions: {}, standard: {} };
  const questions = form.questions.map((q) => {
    const { knockout, ...rest } = q;
    if (knockout && !q.archived) rules.questions[q.id] = knockout;
    return rest;
  });
  if (form.standard_knockouts?.work_authorization) {
    rules.standard.work_authorization = form.standard_knockouts.work_authorization;
  }
  return { stored: { version: 1, questions, standard_fields: { ...form.standard_fields } }, rules };
}

const parseRule = (value: unknown): KnockoutRule | undefined => {
  const parsed = knockoutRuleSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

/** The stored form with its rules put back (for the builder and the submit action). */
export function withRules(stored: ApplicationForm, raw: unknown): ApplicationForm {
  const rules = (raw && typeof raw === "object" ? raw : {}) as { questions?: Record<string, unknown>; standard?: Record<string, unknown> };
  const questions = stored.questions.map((q) => {
    const rule = q.archived ? undefined : parseRule(rules.questions?.[q.id]);
    return rule ? { ...q, knockout: rule } : q;
  });
  const workAuth = parseRule(rules.standard?.work_authorization);
  return {
    ...stored,
    questions,
    standard_knockouts: workAuth ? { work_authorization: workAuth } : undefined,
  };
}
