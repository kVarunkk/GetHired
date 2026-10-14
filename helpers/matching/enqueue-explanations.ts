import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { MATCH_EXPLAIN_TOP_N } from "./config";

export const MATCH_EXPLANATION_QUEUE = "match_explanation_queue";

export type MatchExplanationMessage = { jobPostId: string; userId: string };

/**
 * Queues background explanations for a digest's top candidates (MT-REQ-002):
 * the first MATCH_EXPLAIN_TOP_N rows, by rank, that have none or a stale one.
 * A row is marked `queued` only once its message is sent. Returns the user ids
 * queued. Throws only if marking the rows fails.
 */
export async function enqueueTopExplanations(
  admin: SupabaseClient<Database>,
  jobPostId: string,
  rankedRows: { user_id: string; explanation_status: string }[],
): Promise<string[]> {
  const candidates = rankedRows
    .slice(0, MATCH_EXPLAIN_TOP_N)
    .filter((row) => row.explanation_status === "none" || row.explanation_status === "stale");

  const sent: string[] = [];
  for (const row of candidates) {
    try {
      const message: MatchExplanationMessage = { jobPostId, userId: row.user_id };
      const { error } = await admin.schema("pgmq_public").rpc("send", {
        queue_name: MATCH_EXPLANATION_QUEUE,
        message,
        sleep_seconds: 0,
      });
      if (error) throw new Error(error.message);
      sent.push(row.user_id);
    } catch (err) {
      console.error(`[match explanations] couldn't queue ${row.user_id}`, err);
    }
  }

  if (sent.length > 0) {
    const { error } = await admin
      .from("job_relevant_profiles")
      .update({ explanation_status: "queued" })
      .eq("job_posting_id", jobPostId)
      .in("user_id", sent);
    if (error) throw new Error(`Couldn't mark explanations queued: ${error.message}`);
  }

  return sent;
}
