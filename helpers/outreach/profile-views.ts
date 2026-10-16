import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { PROFILE_VIEW_WINDOW_DAYS } from "./config";

/**
 * Distinct companies that viewed `userId`'s profile in the last `days` days,
 * for workers running as the service role (the candidate's own pages use the
 * `get_my_profile_view_count` RPC). Never throws: a failure counts as 0, so a
 * digest is never held up by it.
 */
export async function countProfileViews(
  admin: SupabaseClient<Database>,
  userId: string,
  days: number = PROFILE_VIEW_WINDOW_DAYS,
): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  try {
    const { data, error } = await admin
      .from("candidate_profile_views")
      .select("company_id")
      .eq("candidate_user_id", userId)
      .gt("viewed_on", since);
    if (error) {
      console.error("[profile-views] couldn't count the views", error.message);
      return 0;
    }
    return new Set((data ?? []).map((row) => row.company_id)).size;
  } catch (err) {
    console.error("[profile-views] couldn't count the views", err);
    return 0;
  }
}
