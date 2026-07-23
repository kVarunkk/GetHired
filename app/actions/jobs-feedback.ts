"use server";

import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createClient } from "@/lib/supabase/server";
import { TJobFeedbackVoteEnum } from "@/utils/types";

type FeedbackStatus = "inserted" | "updated" | "deleted" | "error";

export async function submitJobFeedback(
  jobId: string,
  voteType: TJobFeedbackVoteEnum | null,
): Promise<{ success: boolean; status: FeedbackStatus; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false,
      status: "error",
      error: "Authentication required.",
    };
  }
  const userId = user.id;

  try {
    if (!voteType) {
      const { error: deleteError } = await supabase
        .from("job_feedback")
        .delete()
        .match({ user_id: userId, job_id: jobId });

      if (deleteError) throw deleteError;
      return { success: true, status: "deleted" };
    }

    const { error: upsertError } = await supabase.from("job_feedback").upsert(
      {
        user_id: userId,
        job_id: jobId,
        vote_type: voteType,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id, job_id",
        ignoreDuplicates: false,
      },
    );

    if (upsertError) {
      throw upsertError;
    }

    return { success: true, status: "inserted" };
  } catch (err) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while submitting job feedback.";
    await eventCaptureServerException({
      error: err,
      distinctId: userId,
      properties: { flow: "submit_job_feedback" },
    });
    return { success: false, status: "error", error };
  }
}
