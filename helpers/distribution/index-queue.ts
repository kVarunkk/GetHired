import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const INDEX_PING_QUEUE = "index_ping_queue";
/** Reads before the worker gives up on a message. */
export const INDEX_PING_MAX_READS = 5;

/**
 * One job page to tell the search engines about (MP-REQ-002, `index`
 * channels). `jobId` is the public id (`job_postings.job_id`, the one in
 * `/jobs/[job_id]`). The worker decides at send time whether the job is still
 * public and eligible, so a stale message never pings a closed or private job
 * as live.
 */
export type IndexPingMessage = { jobId: string; reason: "activated" | "updated" | "closed" };

/**
 * Queues a ping. Never throws: a failed enqueue must not fail the job write
 * (the sitemap still lists the job), so it returns false instead.
 */
export async function enqueueIndexPing(message: IndexPingMessage): Promise<boolean> {
  try {
    const { error } = await createServiceRoleClient()
      .schema("pgmq_public")
      .rpc("send", { queue_name: INDEX_PING_QUEUE, message });
    return !error;
  } catch {
    return false;
  }
}
