"use server";

import { createClient } from "../../lib/supabase/server";
import { updateReviewAnalysisStatus } from "@/helpers/resume-review/update-review-analysis";

/**
 * markAnalysisAsFailedAction
 * A Server Action that can be called from Client Components to
 * manually set a review status to 'failed' in the database.
 */
export async function markAnalysisAsFailedAction(reviewId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  try {
    await updateReviewAnalysisStatus(true, reviewId, "failed");

    return { success: true };
  } catch {
    // console.error("[MARK_FAILED_ACTION_ERROR]:", err.message);
    return { error: "Failed to update analysis status." };
  }
}
