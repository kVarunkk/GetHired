import {
  LONG_TEXT_MAX,
  SHORT_TEXT_MAX,
  STANDARD_FIELDS,
  STANDARD_FIELD_KEYS,
  liveQuestions,
  type ApplicationForm,
  type QuestionType,
  type StandardFieldKey,
  type StandardFieldKind,
} from "@/helpers/jobs/application-form-schema";

// AF-REQ-006/007. Validates an applicant's answers against a job's form.
// Client-safe: the applicant form shows the same messages the server returns.
// Answers are keyed by question id, and by `std:<key>` for standard fields.

export type SalaryAnswer = { amount: number; currency: string };
export type AnswerValue = string | string[] | boolean | number | SalaryAnswer;
export type Answers = Record<string, AnswerValue>;

export type ValidateAnswersResult =
  | { ok: true; answers: Answers }
  | { ok: false; fieldErrors: Record<string, string>; formError?: string };

export const standardAnswerKey = (key: StandardFieldKey) => `std:${key}`;

const REQUIRED = "This question is required.";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A field to validate: a form question or an enabled standard field. */
type Field = {
  key: string;
  kind: StandardFieldKind;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  integer?: boolean;
  min_length?: number;
  max_length?: number;
  min_selected?: number;
  max_selected?: number;
  date_rule?: ApplicationForm["questions"][number]["date_rule"];
};

/** The fields `form` asks for, in display order: questions, then standard fields. */
export function fieldsOf(form: ApplicationForm): Field[] {
  const questions: Field[] = liveQuestions(form).map((q) => ({ ...q, key: q.id, kind: q.type }));
  const standard: Field[] = STANDARD_FIELD_KEYS.flatMap((key) => {
    const mode = form.standard_fields[key];
    if (!mode || mode === "off") return [];
    return [{ key: standardAnswerKey(key), kind: STANDARD_FIELDS[key].kind, required: mode === "required" }];
  });
  return [...questions, ...standard];
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function validDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

const textMax = (kind: QuestionType | "salary") => (kind === "long_text" ? LONG_TEXT_MAX : SHORT_TEXT_MAX);

/** One answer: the normalised value, or the message to show. */
function checkField(field: Field, raw: unknown, today: string): { value: AnswerValue } | { error: string } {
  switch (field.kind) {
    case "short_text":
    case "long_text": {
      if (typeof raw !== "string") return { error: "Enter some text." };
      const value = raw.trim();
      const max = Math.min(field.max_length ?? textMax(field.kind), textMax(field.kind));
      if (field.min_length !== undefined && value.length < field.min_length) {
        return { error: `Use at least ${field.min_length} characters.` };
      }
      if (value.length > max) return { error: `Use at most ${max} characters.` };
      return { value };
    }
    case "single_select": {
      if (typeof raw !== "string" || !(field.options ?? []).includes(raw)) return { error: "Pick one of the options." };
      return { value: raw };
    }
    case "multi_select": {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) return { error: "Pick from the options." };
      const picked = raw as string[];
      const options = new Set(field.options ?? []);
      if (picked.some((v) => !options.has(v))) return { error: "Pick from the options." };
      if (new Set(picked).size !== picked.length) return { error: "Pick each option once." };
      if (field.min_selected !== undefined && picked.length < field.min_selected) {
        return { error: `Pick at least ${field.min_selected}.` };
      }
      if (field.max_selected !== undefined && picked.length > field.max_selected) {
        return { error: `Pick at most ${field.max_selected}.` };
      }
      return { value: picked };
    }
    case "yes_no": {
      if (typeof raw !== "boolean") return { error: "Answer yes or no." };
      return { value: raw };
    }
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return { error: "Enter a number." };
      if (field.integer && !Number.isInteger(raw)) return { error: "Enter a whole number." };
      if (field.min !== undefined && raw < field.min) return { error: `Enter at least ${field.min}.` };
      if (field.max !== undefined && raw > field.max) return { error: `Enter at most ${field.max}.` };
      return { value: raw };
    }
    case "date": {
      if (typeof raw !== "string" || !validDate(raw)) return { error: "Enter a valid date." };
      const rule = field.date_rule;
      if (rule === "future" && raw < today) return { error: "Pick a date from today on." };
      if (rule && typeof rule === "object") {
        if (rule.min && raw < rule.min) return { error: `Pick a date on or after ${rule.min}.` };
        if (rule.max && raw > rule.max) return { error: `Pick a date on or before ${rule.max}.` };
      }
      return { value: raw };
    }
    case "url": {
      const bad = { error: "Enter a link starting with http:// or https://." };
      if (typeof raw !== "string") return bad;
      const value = raw.trim();
      if (value.length > 2000) return { error: "Use at most 2000 characters." };
      try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return bad;
      } catch {
        return bad;
      }
      return { value };
    }
    case "salary": {
      const bad = { error: "Enter an amount and a currency." };
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad;
      const { amount, currency } = raw as { amount?: unknown; currency?: unknown };
      if (typeof amount !== "number" || !Number.isFinite(amount) || typeof currency !== "string") return bad;
      if (amount < 0) return { error: "Enter an amount of 0 or more." };
      const code = currency.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) return { error: "Pick a currency." };
      return { value: { amount, currency: code } };
    }
  }
}

/** Today's date as YYYY-MM-DD in UTC. */
export const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Checks `input` against `form`: unknown keys are rejected, required fields
 * enforced, every value checked for its type, and skipped optional fields
 * left out. `today` (YYYY-MM-DD) is for "future only" dates.
 */
export function validateAnswers(
  form: ApplicationForm,
  input: unknown,
  { today = todayIso() }: { today?: string } = {},
): ValidateAnswersResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, fieldErrors: {}, formError: "Answers are missing." };
  }
  const raw = input as Record<string, unknown>;
  const fields = fieldsOf(form);
  const known = new Set(fields.map((f) => f.key));
  if (Object.keys(raw).some((key) => !known.has(key))) {
    return { ok: false, fieldErrors: {}, formError: "Some answers don't match this job's questions." };
  }

  const answers: Answers = {};
  const fieldErrors: Record<string, string> = {};
  for (const field of fields) {
    const value = raw[field.key];
    if (isEmpty(value)) {
      if (field.required) fieldErrors[field.key] = REQUIRED;
      continue;
    }
    const result = checkField(field, value, today);
    if ("error" in result) fieldErrors[field.key] = result.error;
    else answers[field.key] = result.value;
  }

  return Object.keys(fieldErrors).length > 0 ? { ok: false, fieldErrors } : { ok: true, answers };
}
