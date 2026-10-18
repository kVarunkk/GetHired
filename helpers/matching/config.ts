/**
 * Tunables for recruiter matching and screening
 * (plan/recruiter-matching/feature-recruiter-matching-spec.md). Imported by the UI too, so keep
 * this file free of server-only code.
 */

/**
 * MT-GUD-001: the 0–100 rubric bands, highest first. Shared by the prompts
 * and the UI so a score always reads the same way.
 */
export const MATCH_BANDS = [
  { min: 90, word: "Exceptional" },
  { min: 75, word: "Strong" },
  { min: 60, word: "Plausible" },
  { min: 40, word: "Weak" },
  { min: 0, word: "Poor" },
] as const;

export type MatchBand = (typeof MATCH_BANDS)[number];

export function matchBandFor(score: number): MatchBand {
  return MATCH_BANDS.find((band) => score >= band.min) ?? MATCH_BANDS[MATCH_BANDS.length - 1];
}

/** Model for explanations and screening (MT-CON-002). */
export const MT_MODEL = "gemini-3.1-flash-lite";

/** Explanations generated in the background per digest run (MT-REQ-002). */
export const MATCH_EXPLAIN_TOP_N = 20;

/** The job description is cut to this before it goes into a prompt. */
export const MATCH_JOB_DESCRIPTION_MAX_CHARS = 4000;

/** Each resume section and answer is cut to this before it goes into a prompt. */
export const MATCH_CANDIDATE_TEXT_MAX_CHARS = 4000;

/** On-demand "Why this match?" gives up after this (MT-TASK-011). */
export const MATCH_EXPLAIN_TIMEOUT_MS = 20_000;

/** Messages a worker reads per run. */
export const MATCH_WORKER_BATCH_SIZE = 5;

/** Attempts before a queued explanation or screening is marked failed. */
export const MATCH_MAX_ATTEMPTS = 3;

/** MT-REQ-002 caps for an explanation. */
export const MATCH_EXPLANATION_LIMITS = {
  summaryChars: 200,
  items: 3,
  itemChars: 200,
} as const;

export type ScreeningRecommendation = "strong_yes" | "yes" | "maybe" | "no";

/**
 * MT-GUD-001: the recommendation each score band implies, highest first. A
 * screening's recommendation is always replaced by the one for its score.
 */
export const RECOMMENDATION_BANDS: readonly { min: number; recommendation: ScreeningRecommendation }[] = [
  { min: 90, recommendation: "strong_yes" },
  { min: 75, recommendation: "yes" },
  { min: 60, recommendation: "maybe" },
  { min: 0, recommendation: "no" },
];

export function recommendationFor(score: number): ScreeningRecommendation {
  return (RECOMMENDATION_BANDS.find((band) => score >= band.min) ?? RECOMMENDATION_BANDS[RECOMMENDATION_BANDS.length - 1])
    .recommendation;
}

/** How a recommendation reads in the UI. */
export const RECOMMENDATION_LABELS: Record<ScreeningRecommendation, string> = {
  strong_yes: "Strong yes",
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

/** MT-REQ-006 caps for a screening. */
export const SCREENING_LIMITS = {
  summaryChars: 300,
  strengths: 4,
  gaps: 4,
  itemChars: 200,
  mustHaves: 8,
  requirementChars: 120,
  evidenceChars: 120,
  noteChars: 160,
  flags: 3,
} as const;

/** A queued screening's model call gives up after this. */
export const SCREENING_TIMEOUT_MS = 60_000;

/** The UI polls a queued or processing screening this often, for at most SCREENING_POLL_MAX_MS. */
export const SCREENING_POLL_MS = 5_000;
export const SCREENING_POLL_MAX_MS = 120_000;
