import { z } from "zod";

export const MAX_JOB_POSTING_QUESTIONS = 10;
export const MAX_JOB_POSTING_QUESTION_CHARS = 300;

const amount = z.number().finite().min(0);
const optionalAmount = amount.optional();

/** `min <= max`, checked only when both are set (0 means "not set", as in the form). */
const ordered = (min: number | undefined, max: number | undefined) =>
  !min || !max || min <= max;

/**
 * The fields a company may set on a job posting (RS-SEC-002). `.strict()` so a
 * crafted call with `company_id`, `id`, `status`, ... is rejected rather than
 * silently stripped. The server builds the row from this field by field.
 */
export const jobPostingInputSchema = z
  .object({
    title: z.string().trim().min(1, "Job title is required.").max(200),
    description: z.string().trim().min(1, "Job description is required.").max(20000),
    location: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
    job_type: z.enum(["Fulltime", "Intern", "Contract"]),
    salary_currency: z.string().trim().max(5),
    min_salary: amount,
    max_salary: amount,
    min_experience: amount,
    max_experience: optionalAmount,
    visa_sponsorship: z.enum(["Will Sponsor", "Not Required", "Required"]),
    min_equity: amount.max(100).optional(),
    max_equity: amount.max(100).optional(),
    questions: z
      .array(
        z
          .string()
          .trim()
          .max(
            MAX_JOB_POSTING_QUESTION_CHARS,
            `Questions can be at most ${MAX_JOB_POSTING_QUESTION_CHARS} characters.`,
          ),
      )
      .max(
        MAX_JOB_POSTING_QUESTIONS,
        `You can add at most ${MAX_JOB_POSTING_QUESTIONS} questions.`,
      )
      .optional()
      .transform((questions) => (questions ?? []).filter((q) => q !== "")),
    skills: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  })
  .strict()
  .refine((v) => ordered(v.min_salary, v.max_salary), {
    message: "Max salary must be greater than or equal to min salary.",
    path: ["max_salary"],
  })
  .refine((v) => ordered(v.min_experience, v.max_experience), {
    message: "Max experience must be greater than or equal to min experience.",
    path: ["max_experience"],
  })
  .refine((v) => ordered(v.min_equity, v.max_equity), {
    message: "Max equity must be greater than or equal to min equity.",
    path: ["max_equity"],
  });

/** What the create/edit dialog sends. */
export type JobPostingInput = z.input<typeof jobPostingInputSchema>;
/** The validated values the action writes. */
export type JobPostingValues = z.output<typeof jobPostingInputSchema>;
