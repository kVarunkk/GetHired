export const CANDIDATE_EMBEDDING_QUEUE = "candidate_embedding_queue";
/** Reads before the worker gives up on a message. */
export const CANDIDATE_EMBEDDING_MAX_READS = 3;

/**
 * One candidate to (re-)embed. The company_candidates trigger sends it on
 * insert and on a change to an embedded column (CP-REQ-042); the worker loads
 * the row when it runs.
 */
export type CandidateEmbeddingMessage = { candidate_id: string };
