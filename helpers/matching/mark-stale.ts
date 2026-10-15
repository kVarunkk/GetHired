import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { sendScreeningMessages } from "./enqueue-screenings";

/**
 * After a job edit changes its snapshot (MT-REQ-008): marks the job's
 * completed screenings and explanations `stale`, keeping their results until
 * they're replaced, and re-queues the screenings. Explanations are re-queued
 * by the next digest run, which the edit also triggers for an active job.
 * Call it with the service role, after the edit is saved. Throws on failure.
 */
export async function markJobResultsStale(
  admin: SupabaseClient<Database>,
  jobPostId: string,
): Promise<void> {
  const { data: stale, error } = await admin
    .from("application_screenings")
    .update({ status: "stale", attempts: 0, updated_at: new Date().toISOString() })
    .eq("job_post_id", jobPostId)
    .eq("status", "completed")
    .select("application_id");
  if (error) throw new Error(`Couldn't mark screenings stale: ${error.message}`);

  const { error: explanationsError } = await admin
    .from("job_relevant_profiles")
    .update({ explanation_status: "stale" })
    .eq("job_posting_id", jobPostId)
    .eq("explanation_status", "completed");
  if (explanationsError) {
    throw new Error(`Couldn't mark explanations stale: ${explanationsError.message}`);
  }

  await sendScreeningMessages(
    admin,
    (stale ?? []).map((row) => row.application_id),
  );
}
