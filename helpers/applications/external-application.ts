import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

export const EXTERNAL_JOB_NOT_FOUND = "Job not found.";
export const PLATFORM_JOB_REFUSED =
  "This job was applied to through GetHired, so its status is set by the company and can't be changed here.";

/**
 * The job an applicant tracks by hand: an `all_jobs` row that isn't a
 * GetHired posting. Platform applications only go through
 * `submitApplicationAction`, and their status belongs to the company.
 */
export async function loadExternalJob(
  supabase: SupabaseClient<Database>,
  allJobsId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: job, error } = await supabase
    .from("all_jobs")
    .select("id, is_platform_job")
    .eq("id", allJobsId)
    .maybeSingle();
  if (error || !job) return { ok: false, error: EXTERNAL_JOB_NOT_FOUND };
  if (job.is_platform_job) return { ok: false, error: PLATFORM_JOB_REFUSED };
  return { ok: true };
}
