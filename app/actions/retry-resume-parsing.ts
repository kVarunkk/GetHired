"use server";

import { after } from "next/server";
import { createClient } from "../../lib/supabase/server";
import { parseResume } from "@/helpers/resume/parse-resume";

/**
 * retryResumeParsingAction
 * 1. Resets the parsing state in the DB.
 * 2. Uses 'after()' to trigger the AI parser without blocking the UI.
 */
export async function retryResumeParsingAction(resumeId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  try {
    const { error: resetError } = await supabase
      .from("resumes")
      .update({
        parsing_failed: false,
        content: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", resumeId)
      .eq("user_id", user.id);

    if (resetError) throw resetError;

    after(async () => {
      try {
        await parseResume(user.id, resumeId);
      } catch (err) {
        console.error("[RETRY_BG_ERROR]:", err);
      }
    });

    return { success: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to initialize retry.",
    };
  }
}
