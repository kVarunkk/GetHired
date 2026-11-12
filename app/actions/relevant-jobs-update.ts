"use server";

import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { transitionMany } from "@/helpers/db/transition";
import { RELEVANCE_JOBS_QUEUE, RELEVANCE_TIMEOUT_MS } from "@/helpers/jobs/relevance-jobs-queue";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * SERVER ACTION: queues a relevant-jobs run for the session applicant (BW-F03:
 * the user used to come from the client). start_relevance marks the profile
 * `progress` and refuses while a live run holds it, in one statement
 * (SM-REQ-004), since each run makes paid model and rerank calls.
 */
export async function triggerRelevanceUpdate(): Promise<
  { success: true; message: string } | { success: false; error: string }
> {
  const user = await getUserFromRequest();
  if (!user) return { success: false, error: "Sign in first." };
  if (user.app_metadata?.type === "company") {
    return { success: false, error: "Only applicants have job matches." };
  }
  const userId = user.id;

  const supabase = createServiceRoleClient();

  // Started before queueing, so a fast worker's completed/failed isn't overwritten.
  const { data: started, error: startError } = await supabase.rpc("start_relevance", {
    p_user_id: userId,
    p_timeout_seconds: RELEVANCE_TIMEOUT_MS / 1000,
  });
  if (startError) return { success: false, error: "Failed to start generating your matches." };
  const outcome = started as { ok: boolean; reason?: string } | null;
  if (!outcome?.ok) {
    if (outcome?.reason === "in_progress") {
      return { success: false, error: "Your matches are already being generated." };
    }
    if (outcome?.reason === "profile_not_found") return { success: false, error: "Profile not found." };
    return { success: false, error: "Failed to start generating your matches." };
  }

  try {
    const { error: sendError } = await supabase.schema("pgmq_public").rpc("send", {
      queue_name: RELEVANCE_JOBS_QUEUE,
      message: {
        userId,
      },
      sleep_seconds: 0,
    });
    if (sendError) throw sendError;

    return { success: true, message: "processing started" };
  } catch (err) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occured while triggering relevance update.";

    // From `progress` only: nothing was queued, so the run this call started
    // is over. A database error here mustn't hide the send's, reported below.
    await transitionMany(
      supabase,
      "user_info",
      { key: "user_id", ids: [userId], column: "relevant_jobs_update_status" },
      { from: ["progress"], to: "failed", patch: { updated_at: new Date().toISOString() } },
    ).catch(() => undefined);
    await eventCaptureServerException({
      error: err,
      distinctId: userId,
      properties: { flow: "trigger_relevance_update" },
    });

    return {
      success: false,
      error,
    };
  }
}
