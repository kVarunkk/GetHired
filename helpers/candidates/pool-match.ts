import { POOL_MATCH_CEILING, POOL_MATCH_FLOOR } from "@/helpers/matching/config";

/**
 * What a pool match's score is called (CP-REQ-051). It's how close the
 * candidate's profile is to the job's text, not the screening's fit score,
 * and carries no recommendation.
 */
export const POOL_MATCH_LABEL = "Similarity";

/** A cosine similarity as 0–100 for display: [FLOOR, CEILING] stretched, clamped and rounded. */
export function poolMatchScore(similarity: number): number {
  const scaled = ((similarity - POOL_MATCH_FLOOR) / (POOL_MATCH_CEILING - POOL_MATCH_FLOOR)) * 100;
  return Math.round(Math.min(100, Math.max(0, scaled)));
}
