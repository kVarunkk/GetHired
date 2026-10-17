import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import {
  isMatchingInProgress,
  RELEVANCE_PROFILES_QUEUE,
  type RelevanceProfilesMessage,
} from "@/helpers/profiles/relevance-queue";

/**
 * The newest change to any candidate companies can see: a new or edited
 * profile (`updated_at`) or a new embedding (`embedding_updated_at`). Null
 * when there are none.
 */
async function latestProfileChange(supabase: ReturnType<typeof createServiceRoleClient>) {
  const [updated, embedded] = await Promise.all([
    supabase
      .from("user_info")
      .select("updated_at")
      .eq("filled", true)
      .eq("is_public", true)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1),
    supabase
      .from("user_info")
      .select("embedding_updated_at")
      .eq("filled", true)
      .eq("is_public", true)
      .not("embedding_updated_at", "is", null)
      .order("embedding_updated_at", { ascending: false })
      .limit(1),
  ]);
  if (updated.error) throw new Error(`Couldn't read profiles: ${updated.error.message}`);
  if (embedded.error) throw new Error(`Couldn't read profiles: ${embedded.error.message}`);

  const times = [updated.data?.[0]?.updated_at, embedded.data?.[0]?.embedding_updated_at]
    .filter((t): t is string => !!t)
    .map((t) => Date.parse(t));
  return times.length ? Math.max(...times) : null;
}

/**
 * Weekly refresh of candidate matches. Queues a relevant-profiles run for
 * every active job matched before the newest candidate change (or never
 * matched), so new and updated candidates reach each job's matches without
 * the company asking. Jobs already up to date, or with a run in progress,
 * are skipped, since each run makes paid rerank calls.
 */
export async function GET() {
  const headersList = await headers();
  if (headersList.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized access" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  try {
    const latestChange = await latestProfileChange(supabase);

    const { data: jobs, error: jobsError } = await supabase
      .from("job_postings")
      // company_info.user_id is the owner (TM-CON-001), who the worker runs as.
      .select("id, matched_at, matching_status, updated_at, company_info(user_id)")
      .eq("status", "active");
    if (jobsError) throw new Error(`Couldn't read job postings: ${jobsError.message}`);

    const now = Date.now();
    const stale = latestChange === null
      ? []
      : (jobs ?? []).filter(
          (job) =>
            job.company_info?.user_id &&
            !isMatchingInProgress(job, now) &&
            (!job.matched_at || Date.parse(job.matched_at) < latestChange),
        );

    if (stale.length === 0) {
      return NextResponse.json({ success: true, queued: 0, message: "Every job's matches are up to date." });
    }

    const ids = stale.map((job) => job.id);
    const timestamp = new Date(now).toISOString();

    // Marked first, like triggerJobPostingRelevanceUpdate, so a company
    // can't start a second run while this one waits in the queue.
    const { error: markError } = await supabase
      .from("job_postings")
      .update({ matching_status: "progress", matching_error: null, updated_at: timestamp })
      .in("id", ids);
    if (markError) throw new Error(`Couldn't mark jobs in progress: ${markError.message}`);

    const messages: RelevanceProfilesMessage[] = stale.map((job) => ({
      userId: job.company_info!.user_id!,
      jobId: job.id,
    }));
    const { error: sendError } = await supabase.schema("pgmq_public").rpc("send_batch", {
      queue_name: RELEVANCE_PROFILES_QUEUE,
      messages,
      sleep_seconds: 0,
    });
    if (sendError) {
      await supabase
        .from("job_postings")
        .update({ matching_status: "failed", matching_error: "Couldn't queue matching.", updated_at: timestamp })
        .in("id", ids);
      throw new Error(`Couldn't queue matching: ${sendError.message}`);
    }

    await sendEmailForStatusUpdate(
      `PROFILE RELEVANCE CRON: Queued ${messages.length} jobs for a candidate match refresh.`,
    );
    return NextResponse.json({ success: true, queued: messages.length });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await sendEmailForStatusUpdate(`PROFILE RELEVANCE CRON CRITICAL FAILURE:\n${errorMsg}`);
    return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
  }
}
