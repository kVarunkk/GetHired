import { z } from "zod";

// AF-REQ-001/002/003. A job's application form, stored in
// job_postings.application_form. Client-safe: the builder, the applicant
// form and the server all validate with this schema.

export const MAX_FORM_QUESTIONS = 20;
export const MAX_LABEL_CHARS = 300;
export const MAX_HELP_CHARS = 500;
export const MAX_OPTIONS = 30;
export const MAX_OPTION_CHARS = 120;
export const SHORT_TEXT_MAX = 300;
export const LONG_TEXT_MAX = 5000;

export const QUESTION_TYPES = [
  "short_text",
  "long_text",
  "single_select",
  "multi_select",
  "yes_no",
  "number",
  "date",
  "url",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  single_select: "Single choice",
  multi_select: "Multiple choice",
  yes_no: "Yes / no",
  number: "Number",
  date: "Date",
  url: "Link",
};

export const isTextType = (type: QuestionType) => type === "short_text" || type === "long_text";
export const isSelectType = (type: QuestionType) => type === "single_select" || type === "multi_select";
/** AF-REQ-003: the types a knockout rule can be attached to. */
export const KNOCKOUT_TYPES: readonly QuestionType[] = ["yes_no", "single_select", "multi_select", "number"];

/** The value kind of a standard field: a question type, or a salary (amount and currency). */
export type StandardFieldKind = QuestionType | "salary";

/** A standard field's definition. `min`/`integer`/`date_rule` are fixed checks on its answer. */
export type StandardFieldDef = {
  label: string;
  kind: StandardFieldKind;
  profile: string | null;
  min?: number;
  integer?: boolean;
  date_rule?: "future";
};

/**
 * AF-REQ-002 / AF-SEC-001: the fixed standard fields. None asks about a
 * protected characteristic. `profile` names where the applicant form
 * prefills it from.
 */
export const STANDARD_FIELDS = {
  phone: { label: "Phone", kind: "short_text", profile: "phone" },
  linkedin_url: { label: "LinkedIn profile", kind: "url", profile: "linkedin" },
  portfolio_url: { label: "Portfolio or GitHub", kind: "url", profile: "portfolio" },
  current_location: { label: "Current location", kind: "short_text", profile: "location" },
  expected_salary: { label: "Expected salary", kind: "salary", profile: null },
  notice_period_days: { label: "Notice period (days)", kind: "number", profile: null, min: 0, integer: true },
  earliest_start_date: { label: "Earliest start date", kind: "date", profile: null, date_rule: "future" },
  work_authorization: { label: "Are you authorised to work in this job's locations?", kind: "yes_no", profile: null },
  cover_letter: { label: "Cover letter", kind: "long_text", profile: null },
} as const satisfies Record<string, StandardFieldDef>;

export type StandardFieldKey = keyof typeof STANDARD_FIELDS;
export const STANDARD_FIELD_KEYS = Object.keys(STANDARD_FIELDS) as StandardFieldKey[];
export const STANDARD_FIELD_MODES = ["off", "optional", "required"] as const;
export type StandardFieldMode = (typeof STANDARD_FIELD_MODES)[number];

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

export const knockoutConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("equals"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("any_of"), options: z.array(z.string()).min(1).max(MAX_OPTIONS) }).strict(),
  z.object({ kind: z.literal("less_than"), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal("greater_than"), value: z.number().finite() }).strict(),
]);
export type KnockoutCondition = z.infer<typeof knockoutConditionSchema>;

export const KNOCKOUT_ACTIONS = ["flag", "reject"] as const;
export type KnockoutAction = (typeof KNOCKOUT_ACTIONS)[number];

export const knockoutRuleSchema = z
  .object({ fail_if: knockoutConditionSchema, action: z.enum(KNOCKOUT_ACTIONS) })
  .strict();
export type KnockoutRule = z.infer<typeof knockoutRuleSchema>;

/** Which condition kinds fit which question type. */
const CONDITIONS_FOR: Partial<Record<QuestionType, KnockoutCondition["kind"][]>> = {
  yes_no: ["equals"],
  single_select: ["any_of"],
  multi_select: ["any_of"],
  number: ["less_than", "greater_than"],
};

const nonNegativeInt = z.number().int().min(0);

export const questionSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(QUESTION_TYPES),
    label: z.string().trim().min(1, "Every question needs a label.").max(MAX_LABEL_CHARS, `Labels can be at most ${MAX_LABEL_CHARS} characters.`),
    help_text: z.string().trim().max(MAX_HELP_CHARS, `Help text can be at most ${MAX_HELP_CHARS} characters.`).optional(),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(MAX_OPTION_CHARS)).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    integer: z.boolean().optional(),
    min_length: nonNegativeInt.max(LONG_TEXT_MAX).optional(),
    max_length: z.number().int().min(1).max(LONG_TEXT_MAX).optional(),
    min_selected: nonNegativeInt.max(MAX_OPTIONS).optional(),
    max_selected: z.number().int().min(1).max(MAX_OPTIONS).optional(),
    date_rule: z
      .union([z.literal("any"), z.literal("future"), z.object({ min: dateString.optional(), max: dateString.optional() }).strict()])
      .optional(),
    knockout: knockoutRuleSchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    const issue = (message: string, path: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });
    const select = isSelectType(q.type);

    if (select) {
      const options = q.options ?? [];
      if (options.length < 2 || options.length > MAX_OPTIONS) {
        issue(`Choice questions need 2 to ${MAX_OPTIONS} options.`, "options");
      }
      const lower = options.map((o) => o.toLowerCase());
      if (new Set(lower).size !== lower.length) issue("Each option can only appear once.", "options");
    } else if (q.options !== undefined) {
      issue("Only choice questions have options.", "options");
    }

    if (!isTextType(q.type) && (q.min_length !== undefined || q.max_length !== undefined)) {
      issue("Only text questions have a length.", "max_length");
    }
    if (q.min_length !== undefined && q.max_length !== undefined && q.min_length > q.max_length) {
      issue("The minimum length can't be above the maximum.", "min_length");
    }
    if (q.type !== "number" && (q.min !== undefined || q.max !== undefined || q.integer !== undefined)) {
      issue("Only number questions have a range.", "min");
    }
    if (q.min !== undefined && q.max !== undefined && q.min > q.max) {
      issue("The minimum can't be above the maximum.", "min");
    }
    if (q.type !== "multi_select" && (q.min_selected !== undefined || q.max_selected !== undefined)) {
      issue("Only multiple-choice questions have a selection count.", "max_selected");
    }
    if (q.type === "multi_select") {
      const count = q.options?.length ?? 0;
      if (q.max_selected !== undefined && q.max_selected > count) issue("You can't require more choices than there are options.", "max_selected");
      if (q.min_selected !== undefined && q.min_selected > (q.max_selected ?? count)) {
        issue("The minimum number of choices can't be above the maximum.", "min_selected");
      }
    }
    if (q.type !== "date" && q.date_rule !== undefined) issue("Only date questions have a date rule.", "date_rule");

    if (q.knockout) {
      const allowed = CONDITIONS_FOR[q.type];
      if (!allowed) {
        issue("Knockout rules work on yes/no, choice and number questions.", "knockout");
      } else if (!allowed.includes(q.knockout.fail_if.kind)) {
        issue("That rule doesn't fit this question type.", "knockout");
      } else if (q.knockout.fail_if.kind === "any_of") {
        const options = new Set(q.options ?? []);
        if (q.knockout.fail_if.options.some((o) => !options.has(o))) {
          issue("A knockout rule can only use the question's options.", "knockout");
        }
      }
    }
  });
export type FormQuestion = z.infer<typeof questionSchema>;

const standardFieldMode = z.enum(STANDARD_FIELD_MODES).optional();
const standardFieldsSchema = z
  .object({
    phone: standardFieldMode,
    linkedin_url: standardFieldMode,
    portfolio_url: standardFieldMode,
    current_location: standardFieldMode,
    expected_salary: standardFieldMode,
    notice_period_days: standardFieldMode,
    earliest_start_date: standardFieldMode,
    work_authorization: standardFieldMode,
    cover_letter: standardFieldMode,
  } satisfies Record<StandardFieldKey, typeof standardFieldMode>)
  .strict();

const standardKnockoutsSchema = z
  .object({ work_authorization: knockoutRuleSchema.optional() })
  .strict()
  .superRefine((rules, ctx) => {
    for (const [key, rule] of Object.entries(rules)) {
      if (rule && rule.fail_if.kind !== "equals") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That rule doesn't fit this question type.", path: [key] });
      }
    }
  });

export const applicationFormSchema = z
  .object({
    version: z.literal(1),
    questions: z.array(questionSchema).max(MAX_FORM_QUESTIONS, `You can add at most ${MAX_FORM_QUESTIONS} questions.`),
    standard_fields: standardFieldsSchema,
    standard_knockouts: standardKnockoutsSchema.optional(),
  })
  .strict()
  .superRefine((form, ctx) => {
    const ids = form.questions.map((q) => q.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each question needs its own id.", path: ["questions"] });
    }
  });

export type ApplicationForm = z.infer<typeof applicationFormSchema>;
export type StandardKnockouts = NonNullable<ApplicationForm["standard_knockouts"]>;

export function emptyApplicationForm(): ApplicationForm {
  return { version: 1, questions: [], standard_fields: {} };
}

/** A deterministic id for the i-th legacy question, so old answers line up. */
export function legacyQuestionId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

/** AF-CON-001: a job's old `questions: string[]` as required long-text questions. */
export function formFromLegacyQuestions(questions: readonly string[] | null | undefined): ApplicationForm {
  const labels = (questions ?? []).map((q) => q.trim()).filter(Boolean).slice(0, MAX_FORM_QUESTIONS);
  return {
    version: 1,
    questions: labels.map((label, i) => ({
      id: legacyQuestionId(i),
      type: "long_text" as const,
      label: label.slice(0, MAX_LABEL_CHARS),
      required: true,
    })),
    standard_fields: {},
  };
}

/**
 * AF-DEC-003: what the old client sees in `job_postings.questions`: the labels
 * of the form's required, live text questions. It answers each one.
 */
export function legacyQuestionsOf(form: ApplicationForm): string[] {
  return form.questions.filter((q) => !q.archived && q.required && isTextType(q.type)).map((q) => q.label);
}

/** The form's live questions, in order. */
export function liveQuestions(form: ApplicationForm): FormQuestion[] {
  return form.questions.filter((q) => !q.archived);
}

/** Reads a stored `application_form`, falling back to the legacy questions. */
export function readApplicationForm(stored: unknown, legacy?: readonly string[] | null): ApplicationForm {
  const parsed = applicationFormSchema.safeParse(stored);
  if (parsed.success && (parsed.data.questions.length > 0 || Object.keys(parsed.data.standard_fields).length > 0)) {
    return parsed.data;
  }
  return formFromLegacyQuestions(legacy);
}
