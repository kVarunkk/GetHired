import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";

export const LAST_RESUME_ERROR = "You can't delete your only resume. Add another one first.";

export type DeleteResumeResult = { ok: true; reviewsDeleted: number } | { ok: false; error: string };

/**
 * Deletes one of the user's resumes (RE-REQ-037). Its reviews cascade, and
 * applications keep their snapshots (`applications.resume_id` sets null). A
 * stored file stays: the migration owns those.
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
    .select("id");
  if (deleteError) throw new Error(`Failed to delete the resume: ${deleteError.message}`);
  if (!deleted?.length) return { ok: false, error: "Resume not found." };

  if (target.is_primary) {
    const next = resumes!.find((resume) => resume.id !== resumeId)!;
    const { error: promoteError } = await supabase
      .from("resumes")
      .update({ is_primary: true })
      .eq("id", next.id)
      .eq("user_id", user.id);
    if (promoteError) throw new Error(`Failed to set the primary resume: ${promoteError.message}`);

    after(async () => {
      const embedded = await updateUserEmbedding(user.id);
      if (embedded.error) reportError("[RESUME_DELETE_EMBED_FAILED]:", embedded.error);
    });
  }

  return { ok: true, reviewsDeleted: count ?? 0 };
}
