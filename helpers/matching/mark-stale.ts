import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { transitionMany } from "@/helpers/db/transition";
import { sendScreeningsOrFail } from "./queue-screenings";
import { sendExplanationsOrRevert } from "./enqueue-explanations";

/**
 * After a job edit changes its snapshot (MT-REQ-008):
 *
 * - Completed screenings and explanations become `stale`, keeping their
 *   results until they're replaced. The screenings are re-queued; the
 *   explanations are re-queued by the next digest run, which the edit also
 *   triggers for an active job.
 * - Unscored screenings (`insufficient_info`, BI-REQ-036) are re-queued, since
 *   their candidate may have more detail by now.
 * - Running screenings and explanations (`processing`) are re-queued with
 *   their claim cleared (SM-REQ-006): the running worker's result, made
 *   against the old job, is then refused by its claim, and the new message
 *   runs against the edited job. Rows already `queued` are left alone: their
 *   pending message reads the job when it runs.
 *
 * Every write moves only from the states named, so a row a worker finished
 * meanwhile is never reset. Call it with the service role, after the edit is
 * saved. Throws on a database error, or after marking the screenings `failed`
 * when their messages can't be sent.
 */
export async function markJobResultsStale(
  admin: SupabaseClient<Database>,
  jobPostId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const screenings = { key: "application_id", match: { job_post_id: jobPostId } } as const;
  const explanations = {
    key: "user_id",
    match: { job_posting_id: jobPostId },
    column: "explanation_status",
  } as const;

  const { applied: staleScreenings } = await transitionMany(admin, "application_screenings", screenings, {
    from: ["completed"],
    to: "stale",
    patch: { attempts: 0, updated_at: now },
  });
  const { applied: requeuedScreenings } = await transitionMany(admin, "application_screenings", screenings, {
    from: ["insufficient_info", "processing"],
    to: "queued",
    patch: { attempts: 0, claimed_at: null, updated_at: now },
  });

  await transitionMany(admin, "job_relevant_profiles", explanations, { from: ["completed"], to: "stale" });
  const { applied: requeuedExplanations } = await transitionMany(admin, "job_relevant_profiles", explanations, {
    from: ["processing"],
    to: "queued",
    patch: { claimed_at: null },
  });

  // A failed send goes to `stale`: it was running against the old job, and
  // the next digest re-queues stale rows.
  await sendExplanationsOrRevert(
    admin,
    jobPostId,
    requeuedExplanations.map((userId) => ({ userId, revertTo: "stale" })),
  );

  // Stale rows that can't be sent stay `stale` ("Screen unscreened" picks
  // them up); the re-queued ones go to `failed` from `queued`.
  await sendScreeningsOrFail(admin, [...staleScreenings, ...requeuedScreenings]);
}
