import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendInterviewInviteEmail } from "@/helpers/interview/screening/invite";
import {
  SCREENING_INVITE_EMAIL_MAX_READS,
  SCREENING_INVITE_EMAIL_QUEUE,
  type ScreeningInviteEmailMessage,
} from "@/helpers/interview/screening/invite-email-queue";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

type QueueMessage = { msg_id: number; read_ct: number; message: ScreeningInviteEmailMessage };

/** Long enough for a batch to send; a failed message comes back after it. */
const VISIBILITY_TIMEOUT = 120;
const BATCH_SIZE = 50;
/** Sends at once, to stay gentle on the email providers. */
const SEND_CONCURRENCY = 5;

/**
 * Sends the screening invite emails queued by create_screening_invite and a
 * reopen (SI-REQ-013), every minute. The interview and the address are loaded
 * at send time; an interview that's gone, no longer invited (cancelled by a
 * stage move, say) or whose applicant has no address is dropped. A failed
 * send stays in the queue and is retried until
 * `SCREENING_INVITE_EMAIL_MAX_READS`.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const queue = admin.schema("pgmq_public");

  const { data, error } = await queue.rpc("read", {
    queue_name: SCREENING_INVITE_EMAIL_QUEUE,
    sleep_seconds: VISIBILITY_TIMEOUT,
    n: BATCH_SIZE,
  });
  if (error) {
    console.error("[screening invite emails worker] couldn't read the queue", error.message);
    return NextResponse.json({ message: "Couldn't read the queue." }, { status: 500 });
  }
  const messages = (data ?? []) as QueueMessage[];
  if (messages.length === 0) return NextResponse.json({ sent: 0, dropped: 0, failed: 0 });

  const archive = async (msgId: number) => {
    const { error: archiveError } = await queue.rpc("archive", {
      queue_name: SCREENING_INVITE_EMAIL_QUEUE,
      message_id: msgId,
    });
    if (archiveError) {
      console.error(`[screening invite emails worker] couldn't archive ${msgId}`, archiveError.message);
    }
  };

  const ids = [...new Set(messages.map((m) => m.message.application_interview_id))];
  const { data: interviews, error: loadError } = await admin
    .from("application_interviews")
    .select("id, status, applicant_user_id, deadline_at, config_snapshot")
    .in("id", ids);
  if (loadError) {
    console.error("[screening invite emails worker] couldn't load the interviews", loadError.message);
    return NextResponse.json({ message: "Couldn't load the interviews." }, { status: 500 });
  }
  const { data: people, error: peopleError } = await admin
    .from("user_info")
    .select("user_id, email, full_name")
    .in("user_id", [...new Set((interviews ?? []).map((i) => i.applicant_user_id))]);
  if (peopleError) {
    console.error("[screening invite emails worker] couldn't load the applicants", peopleError.message);
    return NextResponse.json({ message: "Couldn't load the applicants." }, { status: 500 });
  }
  const interviewOf = new Map((interviews ?? []).map((i) => [i.id, i]));
  const personOf = new Map((people ?? []).map((p) => [p.user_id, p]));

  const failures: string[] = [];
  let sent = 0;
  let dropped = 0;

  const handle = async ({ msg_id, read_ct, message }: QueueMessage) => {
    const interview = interviewOf.get(message.application_interview_id);
    const person = interview ? personOf.get(interview.applicant_user_id) : undefined;
    if (!interview || interview.status !== "invited" || !person?.email) {
      dropped++;
      await archive(msg_id);
      return;
    }

    try {
      await sendInterviewInviteEmail(interview, { email: person.email, full_name: person.full_name });
    } catch (err) {
      // Left in the queue: it comes back after the visibility timeout.
      console.error("[screening invite emails worker] send failed", interview.id, err);
      if (read_ct >= SCREENING_INVITE_EMAIL_MAX_READS) {
        failures.push(`interview ${interview.id}: ${err instanceof Error ? err.message : String(err)}`);
        await archive(msg_id);
      }
      return;
    }
    sent++;
    await archive(msg_id);
  };

  for (let i = 0; i < messages.length; i += SEND_CONCURRENCY) {
    await Promise.all(messages.slice(i, i + SEND_CONCURRENCY).map(handle));
  }

  if (failures.length > 0) {
    await sendEmailForStatusUpdate(
      `[SCREENING INVITE EMAILS] Gave up on ${failures.length} email(s):\n${failures.join("\n")}`,
    );
  }

  return NextResponse.json({ sent, dropped, failed: failures.length });
}
