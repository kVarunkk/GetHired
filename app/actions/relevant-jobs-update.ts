"use server";

import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function triggerRelevanceUpdate(userId: string) {
  if (!userId) {
    return { success: false, error: "User ID is required" };
  }

  const supabase = createServiceRoleClient();

  try {
    await supabase.schema("pgmq_public").rpc("send", {
      queue_name: "relevance_jobs",
      message: {
        userId,
      },
      sleep_seconds: 0,
    });

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
