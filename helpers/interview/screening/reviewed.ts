/**
 * Whether the team has reviewed the finished interview. A review from before
 * `completedAt` was of an earlier attempt, so it doesn't count.
 */
export function isReviewed(reviewedAt: string | null, completedAt: string): boolean {
  return !!reviewedAt && Date.parse(reviewedAt) >= Date.parse(completedAt);
}
