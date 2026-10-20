import { z } from "zod";
import { MATCH_EXPLANATION_LIMITS, SCREENING_LIMITS } from "./config";

/**
 * What the model returns for "why this candidate" (MT-REQ-002). Caps aren't
 * enforced by the schema, so an over-long answer is trimmed by
 * `normaliseExplanation` rather than thrown away.
 */
export const MatchExplanationSchema = z.object({
  summary: z
    .string()
    .describe(`One sentence, at most ${MATCH_EXPLANATION_LIMITS.summaryChars} characters.`),
  strengths: z
    .array(z.string())
    .describe(`Up to ${MATCH_EXPLANATION_LIMITS.items} ways the candidate meets the job's requirements.`),
  gaps: z
    .array(z.string())
    .describe(`Up to ${MATCH_EXPLANATION_LIMITS.items} job requirements the candidate doesn't show.`),
  conflicts: z
    .array(z.string())
    .describe(
      `Up to ${MATCH_EXPLANATION_LIMITS.items} conflicts between the candidate's stated preferences and the job, e.g. "wants remote; job is onsite in Pune".`,
    ),
});

export type MatchExplanation = z.infer<typeof MatchExplanationSchema>;

const trimList = (items: string[]) =>
  items
    .map((item) => item.trim().slice(0, MATCH_EXPLANATION_LIMITS.itemChars))
    .filter(Boolean)
    .slice(0, MATCH_EXPLANATION_LIMITS.items);

/** Applies the MT-REQ-002 caps. */
export function normaliseExplanation(explanation: MatchExplanation): MatchExplanation {
  return {
    summary: explanation.summary.trim().slice(0, MATCH_EXPLANATION_LIMITS.summaryChars),
    strengths: trimList(explanation.strengths),
    gaps: trimList(explanation.gaps),
    conflicts: trimList(explanation.conflicts),
  };
}

/** Reads a stored `job_relevant_profiles.explanation`, or null if it isn't one. */
export function parseStoredExplanation(value: unknown): MatchExplanation | null {
  const parsed = MatchExplanationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * What the model returns for an application screening (MT-REQ-006). Shared
 * with the UI. Like the explanation, caps aren't in the schema:
 * `normaliseScreening` trims and clamps instead of rejecting.
 */
export const ScreeningResultSchema = z.object({
  fit_score: z.number().describe("0–100, using the score bands."),
  recommendation: z
    .enum(["strong_yes", "yes", "maybe", "no"])
    .describe("Must agree with the fit_score band."),
  summary: z
    .string()
    .describe(`Two plain sentences at most, ${SCREENING_LIMITS.summaryChars} characters.`),
  strengths: z
    .array(z.string())
    .describe(`Up to ${SCREENING_LIMITS.strengths} job requirements the candidate clearly meets.`),
  gaps: z
    .array(z.string())
    .describe(`Up to ${SCREENING_LIMITS.gaps} job requirements the candidate doesn't show.`),
  must_have_coverage: z
    .array(
      z.object({
        requirement: z.string().describe("A must-have from the job."),
        met: z.enum(["yes", "partial", "no", "unknown"]),
        evidence: z
          .string()
          .describe(`Where the candidate shows it, at most ${SCREENING_LIMITS.evidenceChars} characters.`),
      }),
    )
    .describe(`Up to ${SCREENING_LIMITS.mustHaves} of the job's must-have requirements.`),
  answer_feedback: z
    .array(
      z.object({
        question_index: z.number().describe("0-based index of the screening question."),
        quality: z.enum(["strong", "ok", "weak", "missing"]),
        note: z.string().describe(`At most ${SCREENING_LIMITS.noteChars} characters.`),
      }),
    )
    .describe("One entry per screening question."),
  flags: z
    .array(z.string())
    .describe(
      `Up to ${SCREENING_LIMITS.flags} concerns that relate to a stated job requirement, e.g. "salary expectation above range".`,
    ),
});

export type ScreeningResult = z.infer<typeof ScreeningResultSchema>;

/** Reads a stored `application_screenings.result`, or null if it isn't one. */
export function parseStoredScreening(value: unknown): ScreeningResult | null {
  const parsed = ScreeningResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
