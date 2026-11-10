import { isMatchingInProgress } from "@/helpers/profiles/relevance-queue";
import { isRelevanceInProgress } from "@/helpers/jobs/relevance-jobs-queue";

/**
 * What the AI feed on /jobs (an applicant's relevant jobs) or /company/profiles
 * (a job's matched candidates) shows, from the run's state (SM-REQ-005):
 * - `generated`: the feed.
 * - `generating`: the spinner, while a live run holds it.
 * - `failed`: the regenerate button. A `progress` past its timeout is a dead
 *   run, so it lands here instead of spinning forever.
 * - `pending`: never run; the generate button.
 * - `unknown`: the state hasn't loaded yet.
 */
export type FeedView = "generated" | "generating" | "failed" | "pending" | "unknown";

function viewOf(status: string | undefined, live: boolean): FeedView {
  if (status === undefined) return "unknown";
  if (status === "completed") return "generated";
  if (status === "pending") return "pending";
  if (live) return "generating";
  return "failed";
}

export function jobsFeedView(
  profile:
    | {
        relevant_jobs_update_status: string;
        relevance_started_at?: string | null;
        updated_at?: string | null;
      }
    | null
    | undefined,
  now = Date.now(),
): FeedView {
  if (!profile) return "unknown";
  return viewOf(
    profile.relevant_jobs_update_status,
    isRelevanceInProgress(
      {
        relevant_jobs_update_status: profile.relevant_jobs_update_status,
        relevance_started_at: profile.relevance_started_at ?? null,
        updated_at: profile.updated_at ?? null,
      },
      now,
    ),
  );
}

export function profilesFeedView(
  job:
    | {
        matching_status: string;
        matching_started_at?: string | null;
        updated_at?: string | null;
      }
    | null
    | undefined,
  now = Date.now(),
): FeedView {
  if (!job) return "unknown";
  return viewOf(
    job.matching_status,
    isMatchingInProgress(
      {
        matching_status: job.matching_status,
        matching_started_at: job.matching_started_at ?? null,
        updated_at: job.updated_at ?? null,
      },
      now,
    ),
  );
}
