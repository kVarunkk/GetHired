import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

export const LAST_RESUME_ERROR = "You can't delete your only resume. Add another one first.";
export const PRIMARY_RESUME_ERROR =
  "You can't delete your primary resume. Make another resume primary first.";

export type DeleteResumeResult = { ok: true; reviewsDeleted: number } | { ok: false; error: string };

/**
 * Deletes one of the user's resumes (RE-REQ-037). Its reviews cascade, and
 * applications keep their snapshots (`applications.resume_id` sets null). A
 * stored file stays: the migration owns those. The primary resume can't be
 * deleted: the embedding and matches read it, so the user picks the next one
 * (setPrimaryResume, which refreshes them) instead of it being chosen for them.
 */
export async function deleteResume(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  { resumeId }: { resumeId: string },
): Promise<DeleteResumeResult> {
  const { data: resumes, error: listError } = await supabase
    .from("resumes")
    .select("id, is_primary")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false, nullsFirst: false });
  if (listError) throw new Error(`Failed to read the resumes: ${listError.message}`);

  const target = resumes?.find((resume) => resume.id === resumeId);
  if (!target) return { ok: false, error: "Resume not found." };
  if (resumes!.length === 1) return { ok: false, error: LAST_RESUME_ERROR };
  if (target.is_primary) return { ok: false, error: PRIMARY_RESUME_ERROR };

  const { count, error: countError } = await supabase
    .from("resume_reviews")
    .select("id", { count: "exact", head: true })
    .eq("resume_id", resumeId);
  if (countError) throw new Error(`Failed to count the reviews: ${countError.message}`);

  const { data: deleted, error: deleteError } = await supabase
    .from("resumes")
    .delete()
    .eq("id", resumeId)
    .eq("user_id", user.id)
    // It may have been made primary since it was read.
    .eq("is_primary", false)
    .select("id");
  if (deleteError) throw new Error(`Failed to delete the resume: ${deleteError.message}`);
  if (!deleted?.length) return { ok: false, error: "This resume changed. Refresh and try again." };

  return { ok: true, reviewsDeleted: count ?? 0 };
}
