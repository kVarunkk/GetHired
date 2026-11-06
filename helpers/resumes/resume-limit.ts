import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { RESUME_MAX_PER_USER } from "@/helpers/resume/config";

export const RESUME_LIMIT_ERROR = `You can have up to ${RESUME_MAX_PER_USER} resumes. Delete one to add another.`;

/**
 * RE-REQ-036: whether the user can add a resume. Only adding is refused, so
 * users already over the limit keep what they have.
 */
export async function hasRoomForResume(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("resumes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to count resumes: ${error.message}`);
  return (count ?? 0) < RESUME_MAX_PER_USER;
}
