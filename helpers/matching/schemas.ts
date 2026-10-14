import { z } from "zod";
import { MATCH_EXPLANATION_LIMITS } from "./config";

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
