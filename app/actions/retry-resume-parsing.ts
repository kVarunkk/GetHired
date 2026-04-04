"use server";

import { after } from "next/server";
import { createClient } from "../../lib/supabase/server";
import { deploymentUrl } from "@/utils/serverUtils";
import { updateResumeParsingStatus } from "@/helpers/resume/update-resume-parsing";
// import { headers } from "next/headers";
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

/**
 * retryResumeParsingAction
 * 1. Resets the parsing state in the DB.
 * 2. Uses 'after()' to trigger the AI parser without blocking the UI.
 */
export async function retryResumeParsingAction(resumeId: string) {
  const supabase = await createClient();
  //   const headersList = await headers();

  // 1. Auth Guard
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  try {
    // 2. Reset State (Instant DB update)
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

    // 3. Hand off to background processing
    after(async () => {
      try {
        const baseUrl = deploymentUrl();
        const res = await fetch(`${baseUrl}/api/parse-resume`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Secret": INTERNAL_API_SECRET || "",
            // Cookie: headersList.get("Cookie") || "",
          },
          body: JSON.stringify({ resumeId, userId: user.id }),
        });

        if (!res.ok) {
          console.log((await res.json()).error);
          throw new Error(
            `API Parse failed with status: ${res.status}. Error: ${await res.text()}`,
          );
        }
      } catch (err) {
        console.error("[RETRY_BG_ERROR]:", err);
        await updateResumeParsingStatus(true, resumeId);
      }
    });

    return { success: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to initialize retry.",
    };
  }
}
