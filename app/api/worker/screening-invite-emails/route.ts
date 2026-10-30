import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendInterviewInviteEmail } from "@/helpers/interview/screening/invite";
import {
  SCREENING_INVITE_EMAIL_MAX_READS,
  SCREENING_INVITE_EMAIL_QUEUE,
  type ScreeningInviteEmailMessage,
} from "@/helpers/interview/screening/invite-email-queue";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { createClaimLink } from "@/helpers/candidates/claim-token";
import { unsubscribeUrl } from "@/helpers/candidates/unsubscribe-token";
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
 * stage move, say) or whose applicant has no address is dropped. An imported
 * applicant's invite goes to the company candidate's email, unless they
 * unsubscribed, with a new claim link instead of the interview page and the
 * unsubscribe link (BI-REQ-034/040/041). A failed
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
    reportError("[screening invite emails worker] couldn't read the queue", error.message);
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
      reportError(`[screening invite emails worker] couldn't archive ${msgId}`, archiveError.message);
    }
  };

  const ids = [...new Set(messages.map((m) => m.message.application_interview_id))];
  const { data: interviews, error: loadError } = await admin
    .from("application_interviews")
    .select("id, status, applicant_user_id, company_id, company_candidate_id, deadline_at, config_snapshot")
    .in("id", ids);
  if (loadError) {
    reportError("[screening invite emails worker] couldn't load the interviews", loadError.message);
    return NextResponse.json({ message: "Couldn't load the interviews." }, { status: 500 });
  }
  const { data: people, error: peopleError } = await admin
    .from("user_info")
    .select("user_id, email, full_name")
    .in("user_id", [...new Set((interviews ?? []).flatMap((i) => (i.applicant_user_id ? [i.applicant_user_id] : [])))]);
  if (peopleError) {
    reportError("[screening invite emails worker] couldn't load the applicants", peopleError.message);
    return NextResponse.json({ message: "Couldn't load the applicants." }, { status: 500 });
  }
  const candidateIds = [
    ...new Set(
      (interviews ?? []).flatMap((i) => (!i.applicant_user_id && i.company_candidate_id ? [i.company_candidate_id] : [])),
    ),
  ];
  const { data: candidates, error: candidatesError } =
    candidateIds.length > 0
      ? await admin.from("company_candidates").select("id, email, full_name, email_opted_out_at").in("id", candidateIds)
      : { data: [], error: null };
  if (candidatesError) {
    reportError("[screening invite emails worker] couldn't load the candidates", candidatesError.message);
    return NextResponse.json({ message: "Couldn't load the candidates." }, { status: 500 });
  }
  const interviewOf = new Map((interviews ?? []).map((i) => [i.id, i]));
  const personOf = new Map((people ?? []).map((p) => [p.user_id, p]));
  const candidateOf = new Map((candidates ?? []).map((c) => [c.id, c]));

  const failures: string[] = [];
  let sent = 0;
  let dropped = 0;

  const handle = async ({ msg_id, read_ct, message }: QueueMessage) => {
    const interview = interviewOf.get(message.application_interview_id);
    const person = interview?.applicant_user_id ? personOf.get(interview.applicant_user_id) : undefined;
    const candidate =
      interview && !interview.applicant_user_id && interview.company_candidate_id
        ? candidateOf.get(interview.company_candidate_id)
        : undefined;
    const toEmail = person?.email ?? (candidate?.email_opted_out_at ? null : candidate?.email);
    if (!interview || interview.status !== "invited" || !toEmail) {
      dropped++;
      await archive(msg_id);
      return;
    }

    try {
      if (candidate) {
        const claimUrl = await createClaimLink(admin, {
          companyId: interview.company_id,
          candidateId: candidate.id,
          applicationInterviewId: interview.id,
          expiresAt: interview.deadline_at,
        });
        await sendInterviewInviteEmail(
          interview,
          { email: toEmail, full_name: candidate.full_name },
          { claimUrl, unsubscribeUrl: unsubscribeUrl(candidate.id) },
        );
      } else {
        await sendInterviewInviteEmail(interview, { email: toEmail, full_name: person?.full_name ?? null });
      }
    } catch (err) {
      // Left in the queue: it comes back after the visibility timeout.
      reportError("[screening invite emails worker] send failed", interview.id, err);
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
