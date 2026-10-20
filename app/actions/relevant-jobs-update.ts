"use server";

import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { isMatchingInProgress } from "@/helpers/profiles/relevance-queue";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * SERVER ACTION: queues a relevant-jobs run for the session applicant (BW-F03:
 * the user used to come from the client). It marks the profile `progress`
 * itself and refuses while a recent run is still going, since each run makes
 * paid model and rerank calls.
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

  const { data: profile, error: loadError } = await supabase
    .from("user_info")
    .select("relevant_jobs_update_status, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (loadError) return { success: false, error: "Failed to load your profile." };
  if (!profile) return { success: false, error: "Profile not found." };

  if (
    isMatchingInProgress({
      matching_status: profile.relevant_jobs_update_status,
      updated_at: profile.updated_at ?? new Date(0).toISOString(),
    })
  ) {
    return { success: false, error: "Your matches are already being generated." };
  }

  try {
    // Marked before queueing, so a fast worker's completed/failed isn't overwritten.
    const { error: markError } = await supabase
      .from("user_info")
      .update({
        relevant_jobs_update_status: "progress",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (markError) throw markError;

    const { error: sendError } = await supabase.schema("pgmq_public").rpc("send", {
      queue_name: "relevance_jobs",
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

    await supabase
      .from("user_info")
      .update({
        relevant_jobs_update_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
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
