import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

export const RESUME_REVIEWS_DEFAULT_LIMIT = 10;
export const RESUME_REVIEWS_MAX_LIMIT = 50;

/**
 * The user's resume reviews, newest first, for MCP. `user` must come from the
 * session or tool context.
 */
export async function listResumeReviews(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  { limit }: { limit?: number } = {},
) {
  const size = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit!), 1), RESUME_REVIEWS_MAX_LIMIT)
    : RESUME_REVIEWS_DEFAULT_LIMIT;

  const { data, error } = await supabase
    .from("resume_reviews")
    .select(
      `id, name, status, score, created_at, updated_at, analysis_failed, resume_id, job_id`,
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(size);
  if (error) throw error;
  return data;
}
