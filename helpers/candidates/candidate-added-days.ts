// Client-safe: the Candidates table imports it, and list-candidates.ts reads
// location aliases with the service role.

/** CP-REQ-071: the "Added" filter's windows, in days. */
export const CANDIDATE_ADDED_DAYS = [7, 30, 90] as const;
export type CandidateAddedDays = (typeof CANDIDATE_ADDED_DAYS)[number];
