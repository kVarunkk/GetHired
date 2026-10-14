/**
 * Tunables for recruiter matching and screening
 * (plan/feature-recruiter-matching-spec.md). Imported by the UI too, so keep
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
