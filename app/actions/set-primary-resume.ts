"use server";

import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { createClient } from "@/lib/supabase/server";

/**
 * Server action to update the user's primary resume
 * and trigger necessary background workers.
 */
export async function setPrimaryResumeAction(resumeId: string) {
  try {
    const supabase = await createClient();

    // 1. Authenticate user securely on the server
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Unauthorized access." };
    }

    // 2. Perform database updates
    // Reset all primary flags for this user
    const { error: clearError } = await supabase
      .from("resumes")
      .update({ is_primary: false })
      .eq("user_id", user.id);

    if (clearError) throw clearError;

    // Set the target resume as primary
    const { error: setError } = await supabase
      .from("resumes")
      .update({ is_primary: true })
      .eq("id", resumeId);

    if (setError) throw setError;

    // 3. Trigger Background Task
    // Instead of raw client-side fetches, we call the backend logic directly.
    // Wrap it in a non-blocking background context if you don't want to wait for it.
    const embedRes = await updateUserEmbedding(user.id);
    if (embedRes.error) throw new Error("Background Embedding Failed");

    return { success: true };
  } catch (error) {
    console.error("[SET_PRIMARY_RESUME_ERROR]:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update primary resume.",
    };
  }
}
