/**
 * The lifecycle of a match explanation (`job_relevant_profiles.explanation_status`),
 * the same list as the column's check constraint (SM-REQ-008). Client-safe.
 *
 * - `none`: never made. `stale`: made for an older match, kept until replaced.
 * - `queued`: a message is pending. `processing`: a worker has claimed it
 *   (SM-REQ-003, `claimed_at`).
 * - `completed`: the explanation is stored. `failed`, `skipped_quota`: not made.
 */
export const EXPLANATION_STATES = [
  "none",
  "queued",
  "processing",
  "completed",
  "failed",
  "stale",
  "skipped_quota",
] as const;

export type ExplanationStatus = (typeof EXPLANATION_STATES)[number];

/**
 * The one reading every surface uses: an explanation is shown only when it's
 * `completed`. Everything else, `queued` and `processing` alike, is "not
 * ready", and the "Why?" action stays available.
 */
export const isExplanationReady = (status: string | null | undefined): status is "completed" =>
  status === "completed";
