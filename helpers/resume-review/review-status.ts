/**
 * A resume review's state (SM-REQ-009). Client-safe.
 *
 * `resume_reviews` stores it in two columns: `status` and the older
 * `analysis_failed`. `improveResume` only ever writes `completed`; `draft`,
 * `processing` and `failed` come from the old review flow (rows already
 * stored, and the deployed applicant code until it's gone). This is the one
 * place that combines them: `analysis_failed` wins, and a missing status
 * reads `completed`. `REVIEW_STATES` matches `resume_reviews_status_check`
 * (`20261110160000_lifecycle_checks.sql`); a test keeps them equal.
 */
export const REVIEW_STATES = ["draft", "processing", "completed", "failed"] as const;

export type TResumeReviewStatus = (typeof REVIEW_STATES)[number];

const isReviewState = (value: string): value is TResumeReviewStatus =>
  (REVIEW_STATES as readonly string[]).includes(value);

export function reviewStatus(row: {
  status: string | null;
  analysis_failed: boolean | null;
}): TResumeReviewStatus {
  if (row.analysis_failed) return "failed";
  return row.status && isReviewState(row.status) ? row.status : "completed";
}

/** The row with `status` read through `reviewStatus` and `analysis_failed` left out. */
export function withReviewStatus<T extends { status: string | null; analysis_failed: boolean | null }>(
  row: T,
): Omit<T, "analysis_failed" | "status"> & { status: TResumeReviewStatus } {
  const { analysis_failed, status, ...rest } = row;
  return { ...(rest as Omit<T, "analysis_failed" | "status">), status: reviewStatus({ status, analysis_failed }) };
}
