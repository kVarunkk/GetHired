import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";

/**
 * Makes `resumeId` the user's primary resume and re-embeds their profile.
 * Shared by `setPrimaryResumeAction`, the agent and MCP. `user` must come
 * from the session or tool context, never from input.
 */
export async function setPrimaryResume(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  resumeId: string,
): Promise<{ success: true; error?: undefined } | { success: false; error: string }> {
  try {
    const { error: clearError } = await supabase
      .from("resumes")
      .update({ is_primary: false })
      .eq("user_id", user.id);

    if (clearError) throw clearError;

    const { error: setError } = await supabase
      .from("resumes")
      .update({ is_primary: true })
      .eq("id", resumeId)
      .eq("user_id", user.id);

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
