"use server";

import { processUserRelevance } from "@/helpers/jobs/relevant-jobs-utils";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";

export async function triggerRelevanceUpdate(userId: string) {
  if (!userId) {
    return { success: false, error: "User ID is required" };
  }

  const supabase = await createClient();

  try {
    after(async () => {
      try {
        processUserRelevance(userId);
      } catch (err) {
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
          properties: { flow: "trigger_relevance_update_after_block" },
        });
      }
    });

    return { success: true, message: "processing started" };
  } catch (err) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occured while triggering relevance update.";

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
