"use server";

import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { createClient } from "@/lib/supabase/server";

/**
 * Server action to update the user's primary resume
 * and trigger necessary background workers.
 */
export async function setPrimaryResumeAction(resumeId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Unauthorized access." };
  }

  try {
    const { error: clearError } = await supabase
      .from("resumes")
      .update({ is_primary: false })
      .eq("user_id", user.id);

    if (clearError) throw clearError;

    const { error: setError } = await supabase
      .from("resumes")
      .update({ is_primary: true })
      .eq("id", resumeId);

    if (setError) throw setError;

    const embedRes = await updateUserEmbedding(user.id);
    if (embedRes.error) throw new Error("Background Embedding Failed");

    return { success: true };
  } catch (err) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while updating primary resume.";
    await eventCaptureServerException({
      error: err,
      distinctId: user.id,
      properties: {
        flow: "set_primary_resume",
        resume_id: resumeId,
      },
    });

    return {
      success: false,
      error,
    };
  }
}
