import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  APPLICANT_DIGEST_QUEUE,
  DIGEST_MAX_READS,
  digestSince,
  loadNewApplicants,
  sendApplicantDigest,
  type ApplicantDigestMessage,
} from "@/helpers/notifications/new-applicants";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

type QueueMessage = { msg_id: number; read_ct: number; message: ApplicantDigestMessage };

const VISIBILITY_TIMEOUT = 120;
const BATCH_SIZE = 10;

/**
 * Sends the queued daily digests (PL-TASK-040, PL-TEST-007): one email per
 * company, grouped by job. The watermark moves to the newest application only
 * after a successful send; a failed send is retried up to 3 reads, then
 * archived and reported.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const queue = admin.schema("pgmq_public");

  const { data, error } = await queue.rpc("read", {
    queue_name: APPLICANT_DIGEST_QUEUE,
    sleep_seconds: VISIBILITY_TIMEOUT,
    n: BATCH_SIZE,
  });
  if (error) {
    reportError("[applicant digest worker] couldn't read the queue", error.message);
    return NextResponse.json({ message: "Couldn't read the queue." }, { status: 500 });
  }

  const archive = async (msgId: number) => {
    const { error: archiveError } = await queue.rpc("archive", {
      queue_name: APPLICANT_DIGEST_QUEUE,
      message_id: msgId,
    });
    if (archiveError) throw new Error(`Archive failed: ${archiveError.message}`);
  };

  let sent = 0;
  const failures: string[] = [];

  for (const { msg_id, read_ct, message } of (data ?? []) as QueueMessage[]) {
    try {
      const { data: company, error: companyError } = await admin
        .from("company_info")
        .select("id, name, email, notify_new_applicants, last_applicant_digest_at")
        .eq("id", message.companyId)
        .maybeSingle();
      if (companyError) throw new Error(`Company load failed: ${companyError.message}`);
      // Gone, switched away from daily since it was queued, or nowhere to send.
      if (!company || company.notify_new_applicants !== "daily" || !company.email) {
        await archive(msg_id);
        continue;
      }

      const { jobs, newest } = await loadNewApplicants(admin, {
        companyId: company.id,
        since: digestSince(company.last_applicant_digest_at),
      });
      if (jobs.length === 0 || !newest) {
        await archive(msg_id);
        continue;
      }

      const result = await sendApplicantDigest({
        to: company.email,
        companyName: company.name ?? "your company",
        kind: "daily",
        jobs,
      });
      if (!result.ok) throw new Error(result.error);

      const { error: markError } = await admin
        .from("company_info")
        .update({ last_applicant_digest_at: newest })
        .eq("id", company.id);
      if (markError) throw new Error(`Watermark update failed: ${markError.message}`);

      await archive(msg_id);
      sent++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      reportError(`[applicant digest worker] message ${msg_id} failed`, reason);
      if (read_ct >= DIGEST_MAX_READS) {
        failures.push(`company ${message.companyId}: ${reason}`);
        await archive(msg_id).catch(() => {});
      }
    }
  }

  if (failures.length > 0) {
    await sendEmailForStatusUpdate(
      `[APPLICANT DIGEST] Gave up on ${failures.length} digest(s):\n${failures.join("\n")}`,
    );
  }

  return NextResponse.json({ sent, failed: failures.length });
}
