"use server";

import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { processJobPostingRelevance } from "@/helpers/profiles/relevant-profiles-utils";
import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";

export async function triggerJobPostingRelevanceUpdate(jobId: string) {
  if (!jobId) {
    return { success: false, error: "User ID is required" };
  }
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    return {
      success: false,
      error: "User id not found",
    };
  }

  const userId = user.id;

  try {
    after(async () => {
      try {
        processJobPostingRelevance(userId, jobId);
      } catch (err) {
        await supabase
          .from("job_postings")
          .update({
            matching_status: "failed",
            matching_error: "unknown error occured",
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        await eventCaptureServerException({
          error: err,
          distinctId: userId,
          properties: { flow: "trigger_job_posting_relevance_after_block" },
        });
      }
    });

    return { success: true, message: "processing started" };
  } catch (err) {
    await supabase
      .from("job_postings")
      .update({
        matching_status: "failed",
        matching_error: "unknown error occured",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occured while triggering job posting relevance update.";

    await eventCaptureServerException({
      error: err,
      distinctId: userId,
      properties: { flow: "trigger_job_posting_relevance" },
    });

    return {
      success: false,
      error,
    };
  }
}
