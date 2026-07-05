"use server";

import { processJobPostingRelevance } from "@/helpers/profiles/relevant-profiles-utils";
import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";

export async function triggerJobPostingRelevanceUpdate(jobId: string) {
  if (!jobId) {
    return { success: false, error: "User ID is required" };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) {
      throw new Error("user id not found");
    }

    const userId = user.id;

    after(async () => {
      try {
        processJobPostingRelevance(userId, jobId);
      } catch {
        await supabase
          .from("job_postings")
          .update({
            matching_status: "failed",
            matching_error: "unknown error occured",
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }
    });

    return { success: true, message: "processing started" };
  } catch (error) {
    console.error("[Server Action] Failed to trigger relevance update:", error);
    const errorMsg = error instanceof Error ? error.message : "Unknown error";

    return {
      success: false,
      error: errorMsg,
    };
  }
}
