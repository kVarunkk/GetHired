import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { importCountsOf, importMessage, type ImportCounts } from "./copy";
import { CANDIDATES_LIST_PATH } from "./paths";

export type AddToJobResult = { ok: true; counts: ImportCounts } | { ok: false; error: string };

/**
 * Adds company candidates to a job as imported applications (BI-REQ-005), in
 * its first Applied stage unless `stageId` says otherwise, through
 * `add_candidates_to_job`, which checks applicants.import for the job.
 * Shared by `addCandidatesToJobAction` and the agent's `addCandidatesToJob`.
 * Nobody is emailed. Throws on a database error.
 */
export async function addCandidatesToJob(
  supabase: SupabaseClient<Database>,
  { jobPostId, candidateIds, stageId }: { jobPostId: string; candidateIds: string[]; stageId?: string },
): Promise<AddToJobResult> {
  const { data, error } = await supabase.rpc("add_candidates_to_job", {
    p_job_id: jobPostId,
    p_candidate_ids: candidateIds,
    ...(stageId ? { p_stage_id: stageId } : {}),
  });
  if (error) throw new Error(`Failed to add the candidates: ${error.message}`);
  const result = data as { ok: boolean; reason?: string; counts?: unknown };
  if (!result.ok) return { ok: false, error: importMessage(result.reason) };

  revalidatePath(`/company/job-posts/${jobPostId}`);
  revalidatePath(`/company/job-posts/${jobPostId}/applications`);
  revalidatePath(CANDIDATES_LIST_PATH);
  // A talent list's tab shows its candidates too.
  revalidatePath("/company/profiles");
  return { ok: true, counts: importCountsOf(result.counts) };
}
