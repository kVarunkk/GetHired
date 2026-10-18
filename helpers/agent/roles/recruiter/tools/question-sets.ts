import { tool } from "ai";
import { z } from "zod";
import { applicationFormSchema, type ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { loadJobForm } from "@/helpers/jobs/load-job-form";
import { loadQuestionSets } from "@/helpers/jobs/load-question-sets";
import { copyQuestionSet, QUESTION_SETS_PATH, type QuestionSet } from "@/helpers/jobs/question-sets";
import { deleteQuestionSet, saveQuestionSet } from "@/helpers/jobs/save-question-set";
import { updateJobPostValues } from "./jobs";
import { requireToolPermission, type RecruiterToolContext, uuidInput, withToolErrors } from "./shared";

const questionSetUrl = (id: string) => `${QUESTION_SETS_PATH}/${id}`;
const NOT_FOUND = { error: "That question set isn't in your company." } as const;

/** A set as the model sees it: the questions and standard fields, not the raw form. */
function compactSet(set: QuestionSet) {
  return {
    id: set.id,
    name: set.name,
    questions: set.form.questions
      .filter((q) => !q.archived)
      .map((q) => ({
        label: q.label,
        type: q.type,
        required: q.required,
        ...(q.options ? { options: q.options } : {}),
        ...(q.knockout ? { knockout: q.knockout } : {}),
      })),
    standardFields: Object.fromEntries(Object.entries(set.form.standard_fields).filter(([, v]) => v && v !== "off")),
    ...(set.form.standard_knockouts ? { standardKnockouts: set.form.standard_knockouts } : {}),
    updatedAt: set.updatedAt,
    url: questionSetUrl(set.id),
  };
}

/**
 * AF-REQ-004: the agent lists, applies, saves and deletes question sets with
 * the same helpers as the settings page and the job form. Applying needs
 * jobs.edit on the job and goes through updateJobPostValues, so answered
 * questions stay archived (AF-REQ-005) and the form is fairness-screened.
 * Saving and deleting need question_sets.manage. Every write asks first.
 */
export function createQuestionSetTools(ctx: RecruiterToolContext) {
  const { supabase, company } = ctx;

  const findSet = async (id: string) => {
    const sets = await loadQuestionSets(supabase, company.id);
    if (!sets) throw new Error("Couldn't load the question sets.");
    return sets.find((s) => s.id === id) ?? null;
  };

  return {
    listQuestionSets: tool({
      description:
        "List the company's saved question sets: reusable application forms (questions, standard fields like phone or notice period, and knockout rules) that can be applied to a job.",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "listQuestionSets", async () => {
          const sets = await loadQuestionSets(supabase, company.id);
          if (!sets) return { error: "Couldn't load the question sets." };
          return { sets: sets.map(compactSet), url: QUESTION_SETS_PATH };
        }),
    }),

    applyQuestionSet: tool({
      description:
        "Apply a saved question set to one of the company's job posts. It replaces the job's application form with a copy of the set; questions that already have answers stay on the job, archived.",
      inputSchema: z.object({ jobPostId: uuidInput("job post"), questionSetId: uuidInput("question set") }).strict(),
      execute: ({ jobPostId, questionSetId }) =>
        withToolErrors(ctx, "applyQuestionSet", async () => {
          const denied = requireToolPermission(ctx, "jobs.edit", jobPostId);
          if (denied) return denied;
          const set = await findSet(questionSetId);
          if (!set) return NOT_FOUND;

          const result = await updateJobPostValues(ctx, jobPostId, { application_form: copyQuestionSet(set.form) });
          if ("error" in result) return result;
          return { id: result.id, questionSet: set.name, url: result.url };
        }),
    }),

    saveQuestionSet: tool({
      description:
        "Save a reusable question set: either a copy of one of the company's job posts' application form (jobPostId) or a form you write (applicationForm, same shape as createJobPost's). Pass questionSetId to overwrite an existing set instead of adding one.",
      inputSchema: z
        .object({
          name: z.string().trim().min(1).max(80).describe("The set's name, e.g. \"Engineering\"."),
          questionSetId: uuidInput("question set").optional().describe("An existing set to overwrite."),
          jobPostId: uuidInput("job post").optional().describe("Copy this job post's application form."),
          applicationForm: applicationFormSchema.optional().describe("The form to save, when not copying a job's."),
        })
        .strict()
        .refine((input) => (input.jobPostId === undefined) !== (input.applicationForm === undefined), {
          message: "Pass either jobPostId or applicationForm.",
        }),
      execute: ({ name, questionSetId, jobPostId, applicationForm }) =>
        withToolErrors(ctx, "saveQuestionSet", async () => {
          let form: ApplicationForm;
          if (jobPostId) {
            const denied = requireToolPermission(ctx, "jobs.view", jobPostId);
            if (denied) return denied;
            const loaded = await loadJobForm(supabase, company.id, jobPostId);
            if (!loaded) return { error: "Job post not found." };
            form = loaded.form;
          } else {
            form = applicationForm as ApplicationForm;
          }
          if (questionSetId && !(await findSet(questionSetId))) return NOT_FOUND;

          const result = await saveQuestionSet(supabase, company.id, { id: questionSetId, name, form });
          if (!result.ok) return { error: result.error };
          return { id: result.set.id, name: result.set.name, url: questionSetUrl(result.set.id) };
        }),
    }),

    deleteQuestionSet: tool({
      description: "Delete one of the company's question sets. Jobs it was applied to keep their copy.",
      inputSchema: z.object({ questionSetId: uuidInput("question set") }).strict(),
      execute: ({ questionSetId }) =>
        withToolErrors(ctx, "deleteQuestionSet", async () => {
          const set = await findSet(questionSetId);
          if (!set) return NOT_FOUND;
          const result = await deleteQuestionSet(supabase, company.id, questionSetId);
          if (!result.ok) return { error: result.error };
          return { deleted: set.name, url: QUESTION_SETS_PATH };
        }),
    }),
  };
}
