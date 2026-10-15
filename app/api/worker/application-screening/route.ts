import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { screenApplication } from "@/helpers/matching/screen-application";
import { jobSnapshotHash } from "@/helpers/matching/job-snapshot";
import {
  MATCH_MAX_ATTEMPTS,
  MATCH_WORKER_BATCH_SIZE,
  MT_MODEL,
  SCREENING_TIMEOUT_MS,
} from "@/helpers/matching/config";
import {
  APPLICATION_SCREENING_QUEUE,
  type ApplicationScreeningMessage,
} from "@/helpers/matching/enqueue-screenings";
import { loadCandidate, MATCH_JOB_COLUMNS } from "@/helpers/matching/load-candidate";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

type QueueMessage = {
  msg_id: number;
  read_ct: number;
  message: ApplicationScreeningMessage;
};

/** Seconds a read message stays hidden while it's being processed. */
const VISIBILITY_TIMEOUT = 120;

type Outcome = "done" | "retry" | "failed";

const now = () => new Date().toISOString();

/**
 * Screens queued applications (MT-TASK-022). Messages come from the
 * `applications_enqueue_screening` trigger, the backfill route and the job
 * edit re-screen. Called by the scheduler every minute with
 * X-Internal-Secret.
 */
export async function GET(request: NextRequest) {
  if (
    !INTERNAL_API_SECRET ||
    request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET
  ) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const queue = admin.schema("pgmq_public");

  const { data, error } = await queue.rpc("read", {
    queue_name: APPLICATION_SCREENING_QUEUE,
    sleep_seconds: VISIBILITY_TIMEOUT,
    n: MATCH_WORKER_BATCH_SIZE,
  });
  if (error) {
    console.error("[screening worker] couldn't read the queue", error.message);
    return NextResponse.json({ message: "Couldn't read the queue." }, { status: 500 });
  }

  const messages = (data ?? []) as QueueMessage[];
  const archive = async (msgId: number) => {
    const { error: archiveError } = await queue.rpc("archive", {
      queue_name: APPLICATION_SCREENING_QUEUE,
      message_id: msgId,
    });
    if (archiveError) throw new Error(`Archive failed: ${archiveError.message}`);
  };

  const process = async ({ msg_id, message }: QueueMessage): Promise<Outcome> => {
    const applicationId = message.application_id;

    const { data: screening, error: screeningError } = await admin
      .from("application_screenings")
      .select("id, application_id, company_id, status, job_snapshot_hash, result, attempts")
      .eq("application_id", applicationId)
      .maybeSingle();
    if (screeningError) throw new Error(`Screening load failed: ${screeningError.message}`);
    if (!screening) {
      await archive(msg_id);
      return "done";
    }

    const { data: application, error: applicationError } = await admin
      .from("applications")
      .select("*")
      .eq("id", applicationId)
      .maybeSingle();
    if (applicationError) throw new Error(`Application load failed: ${applicationError.message}`);
    if (!application?.job_post_id) {
      await archive(msg_id);
      return "done";
    }

    const { data: job, error: jobError } = await admin
      .from("job_postings")
      .select(MATCH_JOB_COLUMNS)
      .eq("id", application.job_post_id)
      .maybeSingle();
    if (jobError) throw new Error(`Job load failed: ${jobError.message}`);
    if (!job) {
      await archive(msg_id);
      return "done";
    }

    // Already screened against this version of the job.
    const snapshotHash = jobSnapshotHash(job);
    if (screening.status === "completed" && screening.job_snapshot_hash === snapshotHash) {
      await archive(msg_id);
      return "done";
    }

    const attempts = screening.attempts + 1;
    const { error: processingError } = await admin
      .from("application_screenings")
      .update({ status: "processing", attempts, updated_at: now() })
      .eq("id", screening.id);
    if (processingError) throw new Error(`Status update failed: ${processingError.message}`);

    // A missing profile still leaves the answers and the resume to screen.
    const candidate = application.applicant_user_id
      ? await loadCandidate(admin, application.applicant_user_id, { resumeId: application.resume_id })
      : null;

    const result = await screenApplication(
      {
        job,
        application,
        profile: candidate?.profile ?? {},
        resume: candidate?.resume ?? null,
      },
      { timeoutMs: SCREENING_TIMEOUT_MS },
    );

    if (!result.ok) {
      const lastAttempt = attempts >= MATCH_MAX_ATTEMPTS;
      await admin
        .from("application_screenings")
        .update({
          status: lastAttempt ? "failed" : "queued",
          error_code: result.errorCode,
          updated_at: now(),
        })
        .eq("id", screening.id);
      if (lastAttempt) await archive(msg_id);
      return lastAttempt ? "failed" : "retry";
    }

    // Charged after the model call (BL-TASK-030). The ref is the application,
    // so a retried message and every later re-screen are free.
    try {
      await consumeEntitlement(screening.company_id, "screenings", 1, {
        type: "application_screening",
        id: applicationId,
      });
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      await admin
        .from("application_screenings")
        .update({ status: "skipped_quota", updated_at: now() })
        .eq("id", screening.id);
      await archive(msg_id);
      return "done";
    }

    const { error: saveError } = await admin
      .from("application_screenings")
      .update({
        status: "completed",
        fit_score: result.result.fit_score,
        recommendation: result.result.recommendation,
        result: result.result,
        // One level of history (MT-RISK-003) until the pipeline spec's events.
        ...(screening.result ? { previous_result: screening.result } : {}),
        job_snapshot_hash: snapshotHash,
        model: MT_MODEL,
        error_code: null,
        completed_at: now(),
        updated_at: now(),
      })
      .eq("id", screening.id);
    if (saveError) throw new Error(`Save failed: ${saveError.message}`);

    // The re-screen audit trail (pipeline tasks, difference 6). A system event:
    // no actor. A failed insert doesn't undo the screening.
    const previousFitScore = (screening.result as { fit_score?: unknown } | null)?.fit_score;
    const { error: eventError } = await admin.from("application_events").insert({
      company_id: screening.company_id,
      application_id: applicationId,
      candidate_user_id: application.applicant_user_id,
      type: "screened",
      payload: {
        fit_score: result.result.fit_score,
        recommendation: result.result.recommendation,
        previous_fit_score: typeof previousFitScore === "number" ? previousFitScore : null,
      },
    });
    if (eventError) console.error("[screening worker] screened event failed", eventError.message);

    await archive(msg_id);
    return "done";
  };

  let processed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const message of messages) {
    const applicationId = message.message?.application_id;
    try {
      const outcome = await process(message);
      if (outcome === "done") {
        processed++;
      } else {
        failed++;
        failures.push(`${applicationId}: ${outcome}`);
      }
    } catch (err) {
      failed++;
      failures.push(`${applicationId}: ${err instanceof Error ? err.message : "error"}`);
      console.error(`[screening worker] message ${message.msg_id} failed`, err);

      // Don't retry a message that keeps throwing forever.
      if (message.read_ct >= MATCH_MAX_ATTEMPTS) {
        try {
          await admin
            .from("application_screenings")
            .update({ status: "failed", error_code: "worker_error", updated_at: now() })
            .eq("application_id", applicationId)
            .neq("status", "completed");
          await archive(message.msg_id);
        } catch (giveUpError) {
          console.error(`[screening worker] couldn't give up on ${message.msg_id}`, giveUpError);
        }
      }
    }
  }

  if (failed > 0) {
    await sendEmailForStatusUpdate(
      `[APPLICATION SCREENING] ${failed} of ${messages.length} failed this run:\n${failures.join("\n")}`,
    );
  }

  return NextResponse.json({ processed, failed });
}
