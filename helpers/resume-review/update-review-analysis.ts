import { createClient } from "@/lib/supabase/server";

export const updateReviewAnalysisStatus = async (
  analysisFailed: boolean,
  reviewId: string,
  status: string,
) => {
  const supabase = await createClient();

  await supabase
    .from("resume_reviews")
    .update({
      analysis_failed: analysisFailed,
      status: status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reviewId);
};
