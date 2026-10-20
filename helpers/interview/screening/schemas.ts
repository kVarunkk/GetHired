import { z } from "zod";

// Screening interview schemas (plan/feature-recruiter-screening-interview-spec.md).
// Client-safe: the config form, the server actions, the voice-server callback
// and the analysis worker all validate with these. Every object is strict.

export const MAX_INTERVIEW_QUESTIONS = 8;
export const MAX_QUESTION_CHARS = 300;
export const MAX_COMPETENCIES = 5;
export const MAX_COMPETENCY_NAME_CHARS = 60;
export const MAX_COMPETENCY_DESCRIPTION_CHARS = 300;
export const INTERVIEW_DURATIONS = [10, 15, 20] as const;
export type InterviewDuration = (typeof INTERVIEW_DURATIONS)[number];
export const DEFAULT_DURATION_MINUTES: InterviewDuration = 15;
export const MIN_DEADLINE_DAYS = 3;
export const MAX_DEADLINE_DAYS = 14;
export const DEFAULT_DEADLINE_DAYS = 5;
export const DEFAULT_FIT_THRESHOLD = 70;

/** SI-DEC-001: there's no "every applicant" rule. Manual invites always work. */
export const INVITE_RULES = ["fit_threshold", "manual"] as const;
export type InviteRule = (typeof INVITE_RULES)[number];

export const INTERVIEW_LANGUAGES = ["en"] as const;

// ---------------------------------------------------------------------------
// The job's config (SI-REQ-001), stored in job_interview_configs
// ---------------------------------------------------------------------------

export const interviewQuestionSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "A question can't be empty.")
      .max(MAX_QUESTION_CHARS, `Keep each question under ${MAX_QUESTION_CHARS} characters.`),
  })
  .strict();

export const competencySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "A competency needs a name.")
      .max(MAX_COMPETENCY_NAME_CHARS, `Keep each competency name under ${MAX_COMPETENCY_NAME_CHARS} characters.`),
    description: z
      .string()
      .trim()
      .max(
        MAX_COMPETENCY_DESCRIPTION_CHARS,
        `Keep each competency description under ${MAX_COMPETENCY_DESCRIPTION_CHARS} characters.`,
      ),
  })
  .strict();

const questionsSchema = z
  .array(interviewQuestionSchema)
  .max(MAX_INTERVIEW_QUESTIONS, `Add at most ${MAX_INTERVIEW_QUESTIONS} questions.`);

const competenciesSchema = z
  .array(competencySchema)
  .max(MAX_COMPETENCIES, `Add at most ${MAX_COMPETENCIES} competencies.`);

const durationSchema = z
  .number()
  .refine((v): v is InterviewDuration => (INTERVIEW_DURATIONS as readonly number[]).includes(v), {
    message: "Choose 10, 15 or 20 minutes.",
  });

const DEADLINE_MESSAGE = `The deadline must be ${MIN_DEADLINE_DAYS}–${MAX_DEADLINE_DAYS} days.`;
const THRESHOLD_MESSAGE = "Set the minimum fit score (0–100).";

export const interviewConfigSchema = z
  .object({
    enabled: z.boolean(),
    invite_rule: z
      .enum(INVITE_RULES, { errorMap: () => ({ message: "Choose who gets invited." }) })
      .default("fit_threshold"),
    fit_threshold: z
      .number({ invalid_type_error: THRESHOLD_MESSAGE })
      .int(THRESHOLD_MESSAGE)
      .min(0, THRESHOLD_MESSAGE)
      .max(100, THRESHOLD_MESSAGE)
      .nullable()
      .default(DEFAULT_FIT_THRESHOLD),
    questions: questionsSchema.default([]),
    competencies: competenciesSchema.default([]),
    duration_minutes: durationSchema.default(DEFAULT_DURATION_MINUTES),
    deadline_days: z
      .number()
      .int(DEADLINE_MESSAGE)
      .min(MIN_DEADLINE_DAYS, DEADLINE_MESSAGE)
      .max(MAX_DEADLINE_DAYS, DEADLINE_MESSAGE)
      .default(DEFAULT_DEADLINE_DAYS),
    language: z.enum(INTERVIEW_LANGUAGES).default("en"),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.invite_rule === "fit_threshold" && config.fit_threshold === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: THRESHOLD_MESSAGE, path: ["fit_threshold"] });
    }
    if (config.enabled && config.competencies.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one competency to turn the interview on.",
        path: ["competencies"],
      });
    }
  });

export type InterviewConfig = z.infer<typeof interviewConfigSchema>;
export type InterviewConfigInput = z.input<typeof interviewConfigSchema>;
export type Competency = z.infer<typeof competencySchema>;
export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;

// ---------------------------------------------------------------------------
// The snapshot each invite stores (SI-REQ-003)
// ---------------------------------------------------------------------------

export const configSnapshotSchema = z
  .object({
    questions: questionsSchema,
    competencies: competenciesSchema.min(1),
    duration_minutes: durationSchema,
    deadline_days: z.number().int().min(MIN_DEADLINE_DAYS).max(MAX_DEADLINE_DAYS),
    language: z.enum(INTERVIEW_LANGUAGES),
    company_name: z.string().min(1).max(120),
    job_title: z.string().min(1).max(200),
  })
  .strict();

export type ConfigSnapshot = z.infer<typeof configSnapshotSchema>;

// ---------------------------------------------------------------------------
// The voice server's callback (§3.1, SI-VS-005)
// ---------------------------------------------------------------------------

/** How the voice server says a session ended. */
export const CALLBACK_END_REASONS = [
  "completed",
  "time_limit",
  "inactivity",
  "client_disconnect",
  "error",
] as const;

/** Every `interview_sessions.end_reason`: the voice server's, plus the sweeper's. */
export const END_REASONS = [...CALLBACK_END_REASONS, "no_callback"] as const;
export type EndReason = (typeof END_REASONS)[number];

export const MAX_CALLBACK_TURNS = 200;
export const MAX_TURN_TEXT_CHARS = 4000;

export const transcriptTurnSchema = z
  .object({
    turn_id: z.number().int().nonnegative(),
    timestamp: z.number().finite(),
    user: z.string().max(MAX_TURN_TEXT_CHARS),
    assistant: z.string().max(MAX_TURN_TEXT_CHARS).nullable(),
    interrupted: z.boolean(),
  })
  .strict();

export const transcriptCallbackSchema = z
  .object({
    voiceSessionId: z.string().min(1).max(200),
    interviewId: z.string().uuid(),
    turns: z.array(transcriptTurnSchema).max(MAX_CALLBACK_TURNS),
    endReason: z.enum(CALLBACK_END_REASONS),
    durationSeconds: z.number().int().nonnegative().max(24 * 60 * 60),
  })
  .strict();

export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;
export type TranscriptCallback = z.infer<typeof transcriptCallbackSchema>;

// ---------------------------------------------------------------------------
// The company report (SI-REQ-031/032)
// ---------------------------------------------------------------------------

export const MAX_EVIDENCE_PER_COMPETENCY = 5;

const evidenceSchema = z
  .object({
    turnId: z.number().int().nonnegative(),
    quote: z.string().min(1).max(200),
  })
  .strict();

const reportCompetencySchema = z
  .object({
    name: z.string().min(1).max(MAX_COMPETENCY_NAME_CHARS),
    /** null means "not assessed". */
    score: z.number().int().min(1).max(5).nullable(),
    rationale: z.string().max(400),
    evidence: z.array(evidenceSchema).max(MAX_EVIDENCE_PER_COMPETENCY),
  })
  .strict();

const shortItem = z.string().min(1).max(300);

/**
 * What the model returns. No overall score (code computes it) and no
 * recommendation (SI-REQ-032).
 */
export const screeningReportSchema = z
  .object({
    competencies: z.array(reportCompetencySchema).max(MAX_COMPETENCIES),
    questionCoverage: z
      .array(
        z
          .object({
            question: z.string().max(MAX_QUESTION_CHARS),
            asked: z.boolean(),
            turnId: z.number().int().nonnegative().nullable(),
          })
          .strict(),
      )
      .max(MAX_INTERVIEW_QUESTIONS),
    summary: z.string().max(600),
    strengths: z.array(shortItem).max(3),
    concerns: z.array(shortItem).max(3),
    followUpQuestions: z.array(shortItem).max(5),
  })
  .strict();

/** What `interview_analyses.result` stores: the verified report and the computed overall score. */
export const storedScreeningReportSchema = screeningReportSchema.extend({
  overallScore: z.number().min(1).max(5).nullable(),
});

export type ScreeningReport = z.infer<typeof screeningReportSchema>;
export type StoredScreeningReport = z.infer<typeof storedScreeningReportSchema>;

// ---------------------------------------------------------------------------
// Consent (SI-REQ-020)
// ---------------------------------------------------------------------------

/** Stored with `consented_at`. Bump it whenever the text changes. */
export const SCREENING_CONSENT_VERSION = "2026-10-18";

export function screeningConsentText(companyName: string): string {
  return (
    `You'll talk to an AI interviewer. The conversation is transcribed and shared with ${companyName}, ` +
    `who makes the decision. Audio isn't stored. I agree to take this interview on these terms.`
  );
}
