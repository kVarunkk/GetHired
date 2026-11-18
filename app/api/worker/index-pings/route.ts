import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { reportError } from "@/helpers/posthog/report-error";
import { checkEligibility } from "@/helpers/distribution/eligibility";
import { INDEX_PING_MAX_READS, INDEX_PING_QUEUE, type IndexPingMessage } from "@/helpers/distribution/index-queue";
import { jobPageUrl, pingGoogleIndexing, pingIndexNow } from "@/helpers/distribution/index-ping";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

type QueueMessage = { msg_id: number; read_ct: number; message: IndexPingMessage };

const VISIBILITY_TIMEOUT = 120;
const BATCH_SIZE = 50;

/**
 * Tells the `index` channels about job pages queued by status changes and
 * edits (MPT-014, MP-REQ-002/003). The job is loaded at send time: an active,
 * eligible job is announced as updated; a job that is no longer active (or
 * gone) is announced as deleted; an active job that fails the eligibility
 * checks is not pinged at all. A failed ping stays in the queue and is retried
 * until `INDEX_PING_MAX_READS`, then reported once.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const queue = admin.schema("pgmq_public");

  const { data, error } = await queue.rpc("read", {
    queue_name: INDEX_PING_QUEUE,
    sleep_seconds: VISIBILITY_TIMEOUT,
    n: BATCH_SIZE,
  });
  if (error) {
    reportError("[index pings worker] couldn't read the queue", error.message);
    return NextResponse.json({ message: "Couldn't read the queue." }, { status: 500 });
  }
  const messages = (data ?? []) as QueueMessage[];
  if (messages.length === 0) return NextResponse.json({ pinged: 0, skipped: 0, failed: 0 });

  const archive = async (msgId: number) => {
    const { error: archiveError } = await queue.rpc("archive", { queue_name: INDEX_PING_QUEUE, message_id: msgId });
    if (archiveError) reportError(`[index pings worker] couldn't archive ${msgId}`, archiveError.message);
  };

  const jobIds = [...new Set(messages.map((m) => m.message.jobId))];
  const { data: rows, error: loadError } = await admin
    .from("job_postings")
    .select("job_id, status, title, description, location, workplace_type, company_info(name, logo_url)")
    .in("job_id", jobIds);
  if (loadError) {
    reportError("[index pings worker] couldn't load the jobs", loadError.message);
    return NextResponse.json({ message: "Couldn't load the jobs." }, { status: 500 });
  }
  const byJob = new Map((rows ?? []).map((row) => [row.job_id, row]));

  let pinged = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const { msg_id, read_ct, message } of messages) {
    const row = byJob.get(message.jobId);
    const url = jobPageUrl(message.jobId);
    const active = row?.status === "active";

    if (row && active) {
      const company = row.company_info;
      const check = checkEligibility({
        title: row.title,
        description: row.description,
        locations: row.location,
        remote: row.workplace_type === "remote",
        applyUrl: url,
        companyName: company?.name,
        // The logo only matters to feeds; a page without one is still indexable.
        companyLogoUrl: company?.logo_url ?? "n/a",
      });
      if (!check.eligible) {
        skipped++;
        await archive(msg_id);
        continue;
      }
    }

    const [indexNow, google] = await Promise.all([
      pingIndexNow([url]),
      pingGoogleIndexing(url, active ? "URL_UPDATED" : "URL_DELETED"),
    ]);
    if (indexNow.ok && google.ok) {
      pinged++;
      await archive(msg_id);
    } else if (read_ct >= INDEX_PING_MAX_READS) {
      failures.push(`${url}: ${[indexNow, google].filter((r) => !r.ok).map((r) => r.error ?? r.status).join(", ")}`);
      await archive(msg_id);
    }
    // Otherwise it stays queued and comes back after the visibility timeout.
  }

  if (failures.length > 0) {
    await sendEmailForStatusUpdate(`[INDEX PINGS] Gave up on ${failures.length} ping(s):\n${failures.join("\n")}`);
  }
  return NextResponse.json({ pinged, skipped, failed: failures.length });
}
