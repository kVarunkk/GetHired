import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { reportError } from "@/helpers/posthog/report-error";
import { FEED_BUCKET, FEED_REBUILD_MAX_READS, FEED_REBUILD_QUEUE, feedPath } from "@/helpers/distribution/feed-queue";
import { buildFeed, FEED_PLATFORMS } from "@/helpers/distribution/feeds/build";
import { talentAdapter, talentApplyPostUrl } from "@/helpers/distribution/ingest/board-application";
import { loadFeedJobs } from "@/helpers/distribution/feeds/load-feed-jobs";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

type QueueMessage = { msg_id: number; read_ct: number };

const VISIBILITY_TIMEOUT = 300;
const BATCH_SIZE = 100;

/**
 * Rebuilds the stored feeds (MPT-023, MP-REQ-009, MP-CON-006). Every queued
 * message is coalesced into one rebuild per platform. A failed rebuild leaves
 * the messages queued for a retry; after `FEED_REBUILD_MAX_READS` reads the
 * worker gives up, archives them and emails once.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const queue = admin.schema("pgmq_public");

  const { data, error } = await queue.rpc("read", {
    queue_name: FEED_REBUILD_QUEUE,
    sleep_seconds: VISIBILITY_TIMEOUT,
    n: BATCH_SIZE,
  });
  if (error) {
    reportError("[feeds worker] could not read the queue", error.message);
    return NextResponse.json({ message: "Could not read the queue." }, { status: 500 });
  }
  const messages = (data ?? []) as QueueMessage[];
  if (messages.length === 0) return NextResponse.json({ rebuilt: 0, failed: 0 });

  const builtAt = new Date();
  const talentSecret = process.env[talentAdapter.secretEnv];
  const options = talentSecret ? { talentApplyPostUrl: (jobId: string) => talentApplyPostUrl(jobId, talentSecret) } : {};
  let rebuilt = 0;
  const failures: string[] = [];

  for (const platform of FEED_PLATFORMS) {
    try {
      const jobs = await loadFeedJobs(platform);
      const xml = buildFeed(platform, jobs, builtAt, options);
      const { error: saveError } = await admin.storage
        .from(FEED_BUCKET)
        .upload(feedPath(platform), new Blob([xml], { type: "application/xml" }), {
          upsert: true,
          contentType: "application/xml",
          cacheControl: "300",
        });
      if (saveError) throw new Error(saveError.message);
      rebuilt++;
    } catch (e) {
      failures.push(`${platform}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const giveUp = failures.length > 0 && messages.some((m) => m.read_ct >= FEED_REBUILD_MAX_READS);
  if (failures.length === 0 || giveUp) {
    for (const { msg_id } of messages) {
      const { error: archiveError } = await queue.rpc("archive", { queue_name: FEED_REBUILD_QUEUE, message_id: msg_id });
      if (archiveError) reportError(`[feeds worker] could not archive ${msg_id}`, archiveError.message);
    }
  }
  if (giveUp) {
    await sendEmailForStatusUpdate(`[FEEDS] Gave up rebuilding ${failures.length} feed(s):\n${failures.join("\n")}`);
  }
  return NextResponse.json({ rebuilt, failed: failures.length });
}
