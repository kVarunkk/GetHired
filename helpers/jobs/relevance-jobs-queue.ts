// An applicant's relevant-jobs run. Two pipelines run it: the relevance_jobs
// queue (the jobs page's regenerate and the daily cron) and the onboarding
// pipeline (onboarding and profile refreshes). Client-safe: JobsComponent and
// the applicant agent read the timeout.

import { RUN_BUDGET_MS, runInProgress } from "@/helpers/profiles/relevance-queue";

export const RELEVANCE_JOBS_QUEUE = "relevance_jobs";
/** Seconds before app/api/updates/applicants/relevant-jobs/worker retries a message. */
export const RELEVANCE_JOBS_VISIBILITY_TIMEOUT_S = 60;
export const RELEVANCE_JOBS_MAX_RETRIES = 3;

export const ONBOARDING_QUEUE = "onboarding_pipeline";
/**
 * Seconds before app/api/worker/user/onboarding reads a message again. The
 * pipeline (parse, embed, rerank) is slow, so it must outlast a run, or the
 * next scheduled call processes the user twice.
 */
export const ONBOARDING_VISIBILITY_TIMEOUT_S = 300;
/** Attempts per message: read_ct is 1 on the first read. */
export const ONBOARDING_MAX_RETRIES = 3;

/**
 * An applicant's run still `progress` after this long is dead and may be
 * restarted (SM-REQ-005). Either pipeline may hold the `progress`, so it
 * outlasts the longer retry window of the two.
 */
export const RELEVANCE_TIMEOUT_MS =
  Math.max(
    RELEVANCE_JOBS_MAX_RETRIES * RELEVANCE_JOBS_VISIBILITY_TIMEOUT_S,
    ONBOARDING_MAX_RETRIES * ONBOARDING_VISIBILITY_TIMEOUT_S,
  ) *
    1000 +
  RUN_BUDGET_MS;

/** Whether the applicant's relevant-jobs run is still going. */
export function isRelevanceInProgress(
  profile: {
    relevant_jobs_update_status: string;
    relevance_started_at: string | null;
    updated_at: string | null;
  },
  now = Date.now(),
) {
  return runInProgress(
    profile.relevant_jobs_update_status,
    profile.relevance_started_at,
    profile.updated_at,
    RELEVANCE_TIMEOUT_MS,
    now,
  );
}
