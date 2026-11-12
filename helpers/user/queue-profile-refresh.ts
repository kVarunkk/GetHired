import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RELEVANCE_TIMEOUT_MS } from "@/helpers/jobs/relevance-jobs-queue";
import { reportError } from "@/helpers/posthog/report-error";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";

export type ProfileRefreshResult =
  | { queued: true }
  /** A run is going; it queues one more when it finishes (finish_profile_refresh). */
  | { queued: false; reason: "deferred" }
  | { queued: false; reason: "not_onboarded" | "profile_not_found" };

const REASONS = ["not_onboarded", "profile_not_found"] as const;

/**
 * Queues a re-embed and relevant-jobs rebuild for an onboarded applicant whose
 * profile changed, through the onboarding pipeline (queue_profile_refresh).
 * While a recent run is still going it queues nothing (runs are paid, and two
 * at once can finish out of order): that run queues one follow-up when it
 * ends. `userId` must come from the session or tool context. Database errors
 * are thrown.
 */
export async function queueProfileRefresh(userId: string): Promise<ProfileRefreshResult> {
  const { data, error } = await createServiceRoleClient().rpc("queue_profile_refresh", {
    p_user_id: userId,
    p_stale_seconds: RELEVANCE_TIMEOUT_MS / 1000,
  });
  if (error) throw error;

  const outcome = data as { ok: boolean; queued?: boolean; deferred?: boolean; reason?: string } | null;
  if (outcome?.ok && outcome.queued) return { queued: true };
  if (outcome?.ok && outcome.deferred) return { queued: false, reason: "deferred" };
  const reason = REASONS.find((r) => r === outcome?.reason);
  if (!reason) throw new Error(`queue_profile_refresh returned ${JSON.stringify(data)}`);
  return { queued: false, reason };
}

/** What happened to the matches after a profile change. */
export type ProfileRefreshOutcome = "queued" | "deferred" | "not_refreshed";

/**
 * Call after anything the embedding reads changes: the matching preferences or
 * the primary resume. It queues the full refresh (embedding and matches). When
 * a run is already going, that run queues a follow-up. Unless it queued, it
 * also re-embeds here, so search sees the new profile straight away. Never
 * throws.
 */
export async function refreshProfileAfterChange(userId: string): Promise<ProfileRefreshOutcome> {
  let outcome: ProfileRefreshOutcome = "not_refreshed";
  try {
    const refresh = await queueProfileRefresh(userId);
    if (refresh.queued) return "queued";
    if (refresh.reason === "deferred") outcome = "deferred";
  } catch (error) {
    reportError("[profile refresh] couldn't queue the refresh", error);
  }

  // Reports its own errors and never throws.
  await updateUserEmbedding(userId);
  return outcome;
}

/** The line agent tools return about the matches, for the model to pass on. */
export function profileRefreshMessage(outcome: ProfileRefreshOutcome) {
  switch (outcome) {
    case "queued":
      return "Refreshing. New matches appear on the jobs page in a few minutes, and the user gets an email.";
    case "deferred":
      return "Matches are already being generated. They'll be generated again with this change once that run finishes, in a few minutes.";
    case "not_refreshed":
      return "Matches weren't refreshed. The user can regenerate them from the jobs page.";
  }
}

/**
 * Called by a worker after a refresh run that started at `startedAt`
 * succeeded: queues one more run when the profile changed after that start
 * (finish_profile_refresh). Never throws: the run itself is done.
 */
export async function finishProfileRefresh(userId: string, startedAt: string): Promise<{ requeued: boolean }> {
  try {
    const { data, error } = await createServiceRoleClient().rpc("finish_profile_refresh", {
      p_user_id: userId,
      p_started_at: startedAt,
    });
    if (error) throw error;
    return { requeued: (data as { requeued?: boolean } | null)?.requeued === true };
  } catch (error) {
    reportError("[profile refresh] couldn't check for a follow-up run", error);
    return { requeued: false };
  }
}
