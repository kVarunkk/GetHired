import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

/**
 * One of the user's resumes with its parsed content, or null when the user
 * has no resume with that id. Shared by GET /api/resumes/[resume_id] and
 * MCP. `user` must come from the session or tool context.
 */
export async function getResumeDetails(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  resumeId: string,
) {
  const { data, error } = await supabase
    .from("resumes")
    .select("id, name, content, created_at, updated_at, is_primary")
    .eq("user_id", user.id)
    .eq("id", resumeId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
