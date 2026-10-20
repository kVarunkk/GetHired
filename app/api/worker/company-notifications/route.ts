import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  COMPANY_NOTIFICATION_QUEUE,
  INSTANT_THROTTLE_MS,
  NOTIFICATION_MAX_READS,
  digestSince,
  loadNewApplicants,
  sendApplicantDigest,
  type CompanyNotificationMessage,
} from "@/helpers/notifications/new-applicants";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

type QueueMessage = { msg_id: number; read_ct: number; message: CompanyNotificationMessage };

/** Short, so a throttled message comes back soon after its window ends. */
const VISIBILITY_TIMEOUT = 60;
const BATCH_SIZE = 50;

/**
 * Instant new-applicant emails (PL-REQ-009), every minute. Messages are
 * grouped by job: one email lists every application on the job since its
 * last email, at most once per job per 15 minutes. A throttled message stays
 * in the queue and comes back after the visibility timeout.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const queue = admin.schema("pgmq_public");

  const { data, error } = await queue.rpc("read", {
    queue_name: COMPANY_NOTIFICATION_QUEUE,
    sleep_seconds: VISIBILITY_TIMEOUT,
    n: BATCH_SIZE,
  });
  if (error) {
    console.error("[company notifications worker] couldn't read the queue", error.message);
    return NextResponse.json({ message: "Couldn't read the queue." }, { status: 500 });
  }

  const archive = async (msgId: number) => {
    const { error: archiveError } = await queue.rpc("archive", {
      queue_name: COMPANY_NOTIFICATION_QUEUE,
      message_id: msgId,
    });
    if (archiveError) throw new Error(`Archive failed: ${archiveError.message}`);
  };
  const archiveAll = async (messages: QueueMessage[]) => {
    for (const m of messages) await archive(m.msg_id);
  };

  const byJob = new Map<string, QueueMessage[]>();
  for (const msg of (data ?? []) as QueueMessage[]) {
    const list = byJob.get(msg.message.jobPostId) ?? [];
    list.push(msg);
    byJob.set(msg.message.jobPostId, list);
  }

  const now = Date.now();
  let sent = 0;
  const failures: string[] = [];

  for (const [jobPostId, messages] of byJob) {
    const maxReads = Math.max(...messages.map((m) => m.read_ct));
    try {
      const { data: job, error: jobError } = await admin
        .from("job_postings")
        .select("id, company_id, last_applicant_notified_at, company_info(name, email, notify_new_applicants)")
        .eq("id", jobPostId)
        .maybeSingle();
      if (jobError) throw new Error(`Job load failed: ${jobError.message}`);
      const company = job?.company_info;
      // Gone, or the company switched away from instant since it was queued.
      if (!job || !company || company.notify_new_applicants !== "instant" || !company.email) {
        await archiveAll(messages);
        continue;
      }

      const last = job.last_applicant_notified_at;
      if (last && now - Date.parse(last) < INSTANT_THROTTLE_MS) {
        // Batched into the next send for this job.
        if (maxReads >= NOTIFICATION_MAX_READS) await archiveAll(messages);
        continue;
      }

      const { jobs } = await loadNewApplicants(admin, {
        companyId: job.company_id,
        since: digestSince(last, now),
        jobPostId,
      });
      if (jobs.length === 0) {
        // Already covered by an earlier email.
        await archiveAll(messages);
        continue;
      }

      const result = await sendApplicantDigest({
        to: company.email,
        companyName: company.name ?? "your company",
        kind: "instant",
        jobs,
      });
      if (!result.ok) throw new Error(result.error);

      const { error: markError } = await admin
        .from("job_postings")
        .update({ last_applicant_notified_at: new Date(now).toISOString() })
        .eq("id", jobPostId);
      if (markError) throw new Error(`Throttle update failed: ${markError.message}`);

      await archiveAll(messages);
      sent++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[company notifications worker] job ${jobPostId} failed`, reason);
      if (maxReads >= NOTIFICATION_MAX_READS) {
        failures.push(`job ${jobPostId}: ${reason}`);
        await archiveAll(messages).catch(() => {});
      }
    }
  }

  if (failures.length > 0) {
    await sendEmailForStatusUpdate(
      `[COMPANY NOTIFICATIONS] Gave up on ${failures.length} job(s):\n${failures.join("\n")}`,
    );
  }

  return NextResponse.json({ sent, failed: failures.length });
}
