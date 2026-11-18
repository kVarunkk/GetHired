import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const FEED_REBUILD_QUEUE = "feed_rebuild_queue";
/** Private Storage bucket holding one `<platform>.xml` per feed. */
export const FEED_BUCKET = "feeds";
export const feedPath = (platform: string) => `${platform}.xml`;
/** Reads before the worker gives up on a message. */
export const FEED_REBUILD_MAX_READS = 5;

export type FeedRebuildMessage = { reason: "job_changed" | "settings_changed" };

/**
 * Marks the feeds stale (MP-REQ-009). The worker coalesces every queued
 * message into one rebuild per platform, so many edits cost one build. Never
 * throws: a failed enqueue must not fail the job write.
 */
export async function enqueueFeedRebuild(message: FeedRebuildMessage = { reason: "job_changed" }): Promise<boolean> {
  try {
    const { error } = await createServiceRoleClient()
      .schema("pgmq_public")
      .rpc("send", { queue_name: FEED_REBUILD_QUEUE, message });
    return !error;
  } catch {
    return false;
  }
}
