import { applicationFormSchema, type ApplicationForm } from "./application-form-schema";

// AF-REQ-004: reusable question sets (company_question_sets). Members with
// jobs.view list and apply them; applying copies the set into the job.
// question_sets.manage saves and deletes. RLS enforces both again.

export const MAX_QUESTION_SETS = 25;

/** Settings page where sets are created and edited. */
export const QUESTION_SETS_PATH = "/company/settings/question-sets";

export type QuestionSet = { id: string; name: string; form: ApplicationForm; updatedAt: string };

/** A stored row, or null when its form no longer validates. */
export function toQuestionSet(row: { id: string; name: string; form: unknown; updated_at: string }): QuestionSet | null {
  const form = applicationFormSchema.safeParse(row.form);
  return form.success ? { id: row.id, name: row.name, form: form.data, updatedAt: row.updated_at } : null;
}

export function questionSetError(error: { code?: string; message?: string }): string {
  if (error.code === "23505") return "A set with this name already exists.";
  if (error.message === "QUESTION_SET_LIMIT") return `You can keep up to ${MAX_QUESTION_SETS} question sets.`;
  return "Couldn't save the question set. Please try again.";
}

/**
 * The set's form as a new copy for a job: fresh question ids (so they can't
 * collide with the job's answered or archived ones) and its rules moved along.
 */
export function copyQuestionSet(form: ApplicationForm, newId: () => string = () => crypto.randomUUID()): ApplicationForm {
  return {
    version: 1,
    questions: form.questions.filter((q) => !q.archived).map((q) => ({ ...q, id: newId() })),
    standard_fields: { ...form.standard_fields },
    ...(form.standard_knockouts ? { standard_knockouts: { ...form.standard_knockouts } } : {}),
  };
}

/**
 * AF-REQ-005: applying a set to a job replaces its questions, but questions
 * that already have answers stay on the form, archived.
 */
export function applyQuestionSet(
  current: ApplicationForm,
  copy: ApplicationForm,
  answeredQuestionIds: readonly string[] = [],
): ApplicationForm {
  const answered = new Set(answeredQuestionIds);
  const kept = current.questions.filter((q) => q.archived || answered.has(q.id)).map((q) => ({ ...q, archived: true }));
  return { ...copy, questions: [...copy.questions, ...kept] };
}

/**
 * AF-REQ-005 for a form written whole (the agent's updateJobPost): questions
 * of `current` that are answered or archived and missing from `next` stay on
 * it, archived, so their answers keep their labels.
 */
export function keepAnsweredQuestions(
  current: ApplicationForm,
  next: ApplicationForm,
  answeredQuestionIds: readonly string[],
): ApplicationForm {
  const answered = new Set(answeredQuestionIds);
  const present = new Set(next.questions.map((q) => q.id));
  const kept = current.questions
    .filter((q) => (q.archived || answered.has(q.id)) && !present.has(q.id))
    .map((q) => ({ ...q, archived: true }));
  return kept.length ? { ...next, questions: [...next.questions, ...kept] } : next;
}
