import { reportError } from "@/helpers/posthog/report-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { transitionMany } from "@/helpers/db/transition";
import { MATCH_EXPLAIN_TOP_N } from "./config";

export const MATCH_EXPLANATION_QUEUE = "match_explanation_queue";

export type MatchExplanationMessage = { jobPostId: string; userId: string };

/** The states an explanation is queued from: never made, or out of date. */
const ENQUEUE_FROM = ["none", "stale"] as const;

/**
 * Queues background explanations for a digest's top candidates (MT-REQ-002):
 * the first MATCH_EXPLAIN_TOP_N rows, by rank, that have none or a stale one.
 *
 * The rows are marked `queued` before the messages go out, and only from
 * `none` or `stale` (SM-ISS-003, SM-TEST-010): marking after the send let a
 * fast worker's `completed` be turned back into `queued`, which then hid the
 * explanation. A row whose send fails goes back from `queued` to the state it
 * was in (`sendExplanationsOrRevert`), so the next digest picks it up.
 * `rankedRows`' statuses only choose the candidates; the writes check the
 * stored state. Returns the user ids sent. Throws only if marking the rows
 * fails.
 */
export async function enqueueTopExplanations(
  admin: SupabaseClient<Database>,
  jobPostId: string,
  rankedRows: { user_id: string; explanation_status: string }[],
): Promise<string[]> {
  const candidates = rankedRows
    .slice(0, MATCH_EXPLAIN_TOP_N)
    .filter((row) => (ENQUEUE_FROM as readonly string[]).includes(row.explanation_status));
  if (candidates.length === 0) return [];

  const { applied } = await transitionMany(
    admin,
    "job_relevant_profiles",
    {
      key: "user_id",
      ids: candidates.map((row) => row.user_id),
      match: { job_posting_id: jobPostId },
      column: "explanation_status",
    },
    { from: ENQUEUE_FROM, to: "queued" },
  );
  const marked = new Set(applied);

  return sendExplanationsOrRevert(
    admin,
    jobPostId,
    candidates
      .filter((row) => marked.has(row.user_id))
      .map((row) => ({ userId: row.user_id, revertTo: row.explanation_status })),
  );
}

/**
 * Sends one message per explanation just moved to `queued`. A row whose send
 * fails goes back from `queued` to `revertTo`, so none stays `queued` with no
 * message; from `queued` only, so a row an on-demand "Why?" completed
 * meanwhile keeps its explanation. Returns the user ids sent. Never throws:
 * failures are reported.
 */
export async function sendExplanationsOrRevert(
  admin: SupabaseClient<Database>,
  jobPostId: string,
  rows: { userId: string; revertTo: string }[],
): Promise<string[]> {
  const sent: string[] = [];
  const unsent: { userId: string; revertTo: string }[] = [];
  for (const row of rows) {
    try {
      const message: MatchExplanationMessage = { jobPostId, userId: row.userId };
      const { error } = await admin.schema("pgmq_public").rpc("send", {
        queue_name: MATCH_EXPLANATION_QUEUE,
        message,
        sleep_seconds: 0,
      });
      if (error) throw new Error(error.message);
      sent.push(row.userId);
    } catch (err) {
      reportError(`[match explanations] couldn't queue ${row.userId}`, err);
      unsent.push(row);
    }
  }

  for (const state of new Set(unsent.map((row) => row.revertTo))) {
    const ids = unsent.filter((row) => row.revertTo === state).map((row) => row.userId);
    try {
      await transitionMany(
        admin,
        "job_relevant_profiles",
        { key: "user_id", ids, match: { job_posting_id: jobPostId }, column: "explanation_status" },
        { from: ["queued"], to: state },
      );
    } catch (err) {
      reportError("[match explanations] couldn't un-queue unsent explanations", err);
    }
  }

  return sent;
}
