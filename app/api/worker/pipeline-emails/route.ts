import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendCompanyMessage } from "@/helpers/email/send-company-message";
import {
  PIPELINE_EMAIL_MAX_READS,
  PIPELINE_EMAIL_QUEUE,
  type PipelineEmailMessage,
} from "@/helpers/pipeline/email-queue";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import type { TablesInsert } from "@/utils/types/database.types";

type QueueMessage = { msg_id: number; read_ct: number; message: PipelineEmailMessage };

/** Long enough for a batch to send; a failed message comes back after it. */
const VISIBILITY_TIMEOUT = 120;
const BATCH_SIZE = 50;
/** Sends at once, to stay gentle on the email providers. */
const SEND_CONCURRENCY = 5;

/**
 * Sends the emails queued by stage moves (`helpers/pipeline/move.ts`), every
 * minute. The recipient is loaded from the database at send time; an
 * application that's gone, moved to another company or has no address is
 * dropped. Each sent email is logged as an `email_sent` event with the
 * member who moved it. A failed send stays in the queue and is retried until
 * `PIPELINE_EMAIL_MAX_READS`.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const queue = admin.schema("pgmq_public");

  const { data, error } = await queue.rpc("read", {
    queue_name: PIPELINE_EMAIL_QUEUE,
    sleep_seconds: VISIBILITY_TIMEOUT,
    n: BATCH_SIZE,
  });
  if (error) {
    console.error("[pipeline emails worker] couldn't read the queue", error.message);
    return NextResponse.json({ message: "Couldn't read the queue." }, { status: 500 });
  }
  const messages = (data ?? []) as QueueMessage[];
  if (messages.length === 0) return NextResponse.json({ sent: 0, dropped: 0, failed: 0 });

  const archive = async (msgId: number) => {
    const { error: archiveError } = await queue.rpc("archive", {
      queue_name: PIPELINE_EMAIL_QUEUE,
      message_id: msgId,
    });
    if (archiveError) console.error(`[pipeline emails worker] couldn't archive ${msgId}`, archiveError.message);
  };

  const ids = [...new Set(messages.map((m) => m.message.applicationId))];
  const { data: rows, error: loadError } = await admin
    .from("applications")
    .select("id, user_info(email), job_postings!inner(company_id)")
    .in("id", ids);
  if (loadError) {
    console.error("[pipeline emails worker] couldn't load the applications", loadError.message);
    return NextResponse.json({ message: "Couldn't load the applications." }, { status: 500 });
  }
  const byId = new Map((rows ?? []).map((row) => [row.id, row]));

  const events: TablesInsert<"application_events">[] = [];
  const failures: string[] = [];
  let dropped = 0;

  const handle = async ({ msg_id, read_ct, message }: QueueMessage) => {
    const row = byId.get(message.applicationId);
    const toEmail = row?.user_info?.email;
    if (!row || row.job_postings.company_id !== message.companyId || !toEmail) {
      dropped++;
      await archive(msg_id);
      return;
    }

    const result = await sendCompanyMessage({
      toEmail,
      subject: message.subject,
      bodyMd: message.body,
      companyName: message.companyName,
      companyEmail: message.companyEmail,
      logoUrl: message.logoUrl,
    });
    if (!result.ok) {
      // Left in the queue: it comes back after the visibility timeout.
      if (read_ct >= PIPELINE_EMAIL_MAX_READS) {
        failures.push(`application ${message.applicationId}: ${result.error}`);
        await archive(msg_id);
      }
      return;
    }

    events.push({
      company_id: message.companyId,
      application_id: message.applicationId,
      candidate_user_id: message.candidateUserId,
      actor_user_id: message.actorUserId,
      actor_name: message.actorName,
      type: "email_sent",
      // The subject only: the body stays out of the log.
      payload: { template_id: message.templateId, subject: message.subject },
    });
    await archive(msg_id);
  };

  for (let i = 0; i < messages.length; i += SEND_CONCURRENCY) {
    await Promise.all(messages.slice(i, i + SEND_CONCURRENCY).map(handle));
  }

  if (events.length > 0) {
    // The emails already went out; a missing log line isn't worth resending them.
    const { error: eventsError } = await admin.from("application_events").insert(events);
    if (eventsError) console.error("[pipeline emails worker] couldn't log the emails", eventsError.message);
  }

  if (failures.length > 0) {
    await sendEmailForStatusUpdate(
      `[PIPELINE EMAILS] Gave up on ${failures.length} email(s):\n${failures.join("\n")}`,
    );
  }

  return NextResponse.json({ sent: events.length, dropped, failed: failures.length });
}
