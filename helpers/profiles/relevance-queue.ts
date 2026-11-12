// The relevant-profiles queue: queueJobPostingRelevance and the weekly
// enqueue route send to it, and app/api/updates/company/relevant-profiles/worker
// reads it. Client-safe: JobsComponent and the previews read the timeout.

export const RELEVANCE_PROFILES_QUEUE = "relevance_profiles";

/** What a message carries: the company owner's user id and the job to match. */
export type RelevanceProfilesMessage = { userId: string; jobId: string };

/**
 * Seconds before the worker reads an unfinished message again. Longer than one
 * run (the digest's rerank can take minutes), so the per-minute schedule
 * doesn't start a second, paid run of the same job while the first is going.
 */
export const RELEVANCE_PROFILES_VISIBILITY_TIMEOUT_S = 300;
/** Attempts per message: read_ct is 1 on the first read. */
export const RELEVANCE_PROFILES_MAX_RETRIES = 3;

/** What one attempt may take on top of the retry window, for the timeouts. */
export const RUN_BUDGET_MS = 5 * 60 * 1000;

/**
 * A matching run still `progress` after this long is dead and may be
 * restarted (SM-REQ-005). It outlasts every retry: a failed attempt keeps the
 * job in `progress` until the worker gives up (SM-REQ-013).
 */
export const MATCHING_TIMEOUT_MS =
  RELEVANCE_PROFILES_MAX_RETRIES * RELEVANCE_PROFILES_VISIBILITY_TIMEOUT_S * 1000 + RUN_BUDGET_MS;

/**
 * The one reading of "a live run", the same as the database's
 * run_in_progress(): `progress` that started less than `timeoutMs` ago. A row
 * from before the start columns falls back to `updatedAt`; `progress` with
 * neither is dead.
 */
export function runInProgress(
  status: string,
  startedAt: string | null | undefined,
  updatedAt: string | null | undefined,
  timeoutMs: number,
  now = Date.now(),
) {
  if (status !== "progress") return false;
  const since = startedAt ?? updatedAt;
  if (!since) return false;
  return now - Date.parse(since) < timeoutMs;
}

/** Whether a matching run for the job is still going, so another isn't started. */
export function isMatchingInProgress(
  posting: { matching_status: string; matching_started_at: string | null; updated_at: string | null },
  now = Date.now(),
) {
  return runInProgress(
    posting.matching_status,
    posting.matching_started_at,
    posting.updated_at,
    MATCHING_TIMEOUT_MS,
    now,
  );
}
