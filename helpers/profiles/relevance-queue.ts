// The relevant-profiles queue: triggerJobPostingRelevanceUpdate and the weekly
// enqueue route send to it, and app/api/updates/company/relevant-profiles/worker
// reads it.

export const RELEVANCE_PROFILES_QUEUE = "relevance_profiles";

/** What a message carries: the company owner's user id and the job to match. */
export type RelevanceProfilesMessage = { userId: string; jobId: string };

/** A run still "in progress" after this long is treated as dead and may be restarted. */
export const STALE_PROGRESS_MS = 15 * 60 * 1000;

/** Whether a matching run for the job is still going, so another isn't started. */
export function isMatchingInProgress(
  posting: { matching_status: string; updated_at: string },
  now = Date.now(),
) {
  return (
    posting.matching_status === "progress" &&
    !(now - Date.parse(posting.updated_at) > STALE_PROGRESS_MS)
  );
}
