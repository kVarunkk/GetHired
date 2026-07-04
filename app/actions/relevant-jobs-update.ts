"use server";

import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";
import { singleUserTask } from "@/helpers/jobs/relevant-jobs-utils";

export async function triggerRelevanceUpdate(userId: string) {
  if (!userId) {
    return { success: false, error: "User ID is required" };
  }

  const supabase = await createClient();

  try {
    after(async () => {
      try {
        singleUserTask(userId);
      } catch {
        await supabase
          .from("user_info")
          .update({
            relevant_jobs_update_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);
      }
    });

    return { success: true, message: "processing started" };
  } catch (error) {
    console.error("[Server Action] Failed to trigger relevance update:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
