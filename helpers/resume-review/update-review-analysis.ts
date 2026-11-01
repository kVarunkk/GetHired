import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

/**
 * Sets a review's analysis status. `supabase` is the caller's user-scoped
 * client, so RLS keeps this to the user's own reviews.
 */
export const updateReviewAnalysisStatus = async (
  supabase: SupabaseClient<Database>,
  analysisFailed: boolean,
  reviewId: string,
  status: string,
) => {
  await supabase
    .from("resume_reviews")
    .update({
      analysis_failed: analysisFailed,
      status: status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reviewId);
};
