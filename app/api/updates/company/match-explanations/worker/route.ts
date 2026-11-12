import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { explainMatch } from "@/helpers/matching/explain-match";
import {
  MATCH_EXPLAIN_TIMEOUT_MS,
  MATCH_MAX_ATTEMPTS,
  MATCH_WORKER_BATCH_SIZE,
} from "@/helpers/matching/config";
import {
  MATCH_EXPLANATION_QUEUE,
  type MatchExplanationMessage,
} from "@/helpers/matching/enqueue-explanations";
import { loadCandidate, MATCH_JOB_COLUMNS } from "@/helpers/matching/load-candidate";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { claimForRun, notUnderLiveClaim, transition, type TransitionPatch } from "@/helpers/db/transition";
import type { Json } from "@/utils/types/database.types";

type QueueMessage = {
  msg_id: number;
  read_ct: number;
  message: MatchExplanationMessage;
};

/** Seconds a read message stays hidden while it's being processed. */
const VISIBILITY_TIMEOUT = 120;

/**
 * The states a run may claim an explanation from (SM-REQ-003): any but
 * `processing` (a dead run's claim releases it) and `completed` (archived
 * before the claim).
 */
const CLAIM_FROM = ["none", "queued", "stale", "failed", "skipped_quota"] as const;

/** `busy`: another run holds the row; the message is left for later. */
type Outcome = "done" | "retry" | "failed" | "busy";

/**
 * Generates queued "why this candidate" explanations for digest top matches
 * (MT-TASK-012). Called by the scheduler every 5 minutes with
 * X-Internal-Secret.
 */
export async function GET(request: NextRequest) {
  // Each run's claim (SM-REQ-003): the time the messages were read, so the
  // next delivery, a visibility timeout later, finds it dead.
  const claimedAt = new Date().toISOString();
  if (
    !INTERNAL_API_SECRET ||
    request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET
  ) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const queue = admin.schema("pgmq_public");

  const { data, error } = await queue.rpc("read", {
    queue_name: MATCH_EXPLANATION_QUEUE,
    sleep_seconds: VISIBILITY_TIMEOUT,
    n: MATCH_WORKER_BATCH_SIZE,
  });
  if (error) {
    reportError("[match explanations worker] couldn't read the queue", error.message);
    return NextResponse.json({ message: "Couldn't read the queue." }, { status: 500 });
  }

  const messages = (data ?? []) as QueueMessage[];
  const archive = async (msgId: number) => {
    const { error: archiveError } = await queue.rpc("archive", {
      queue_name: MATCH_EXPLANATION_QUEUE,
      message_id: msgId,
    });
    if (archiveError) throw new Error(`Archive failed: ${archiveError.message}`);
  };

  const process = async ({ msg_id, read_ct, message }: QueueMessage): Promise<Outcome> => {
    const { jobPostId, userId } = message;
    const lastAttempt = read_ct >= MATCH_MAX_ATTEMPTS;

    const { data: row, error: rowError } = await admin
      .from("job_relevant_profiles")
      .select("id, explanation_status, claimed_at")
      .eq("job_posting_id", jobPostId)
      .eq("user_id", userId)
      .maybeSingle();
    if (rowError) throw new Error(`Row load failed: ${rowError.message}`);

    // No longer matched, or explained on demand meanwhile.
    if (!row || row.explanation_status === "completed") {
      await archive(msg_id);
      return "done";
    }

    const { data: job, error: jobError } = await admin
      .from("job_postings")
      .select(MATCH_JOB_COLUMNS)
      .eq("id", jobPostId)
      .maybeSingle();
    if (jobError) throw new Error(`Job load failed: ${jobError.message}`);
    const candidate = job ? await loadCandidate(admin, userId) : null;
    if (!job || !job.company_id || !candidate) {
      await archive(msg_id);
      return "done";
    }

    // SM-REQ-003: claim the row, so a second run does nothing, and every
    // write below moves it from `processing` under this claim only. A stale
    // pass or an enqueue during the run gets its result refused.
    const claim = await claimForRun(
      admin,
      "job_relevant_profiles",
      { id: row.id, state: row.explanation_status, claimedAt: row.claimed_at },
      { from: CLAIM_FROM, claim: claimedAt, liveForMs: VISIBILITY_TIMEOUT * 1000, column: "explanation_status" },
    );
    // Lost to another run: this message comes back after the visibility
    // timeout and finds the row finished.
    if (claim !== "claimed") return "busy";

    const finish = (to: string, patch: TransitionPatch<"job_relevant_profiles", "explanation_status"> = {}) =>
      transition(
        admin,
        "job_relevant_profiles",
        { id: row.id, column: "explanation_status", claim: claimedAt },
        { from: ["processing"], to, patch },
      );
    // Re-queued or claimed again meanwhile: the newer run explains and
    // charges, so this message is done.
    const superseded = async (): Promise<Outcome> => {
      await archive(msg_id);
      return "done";
    };

    const result = await explainMatch(
      { job, profile: candidate.profile, resume: candidate.resume },
      { timeoutMs: MATCH_EXPLAIN_TIMEOUT_MS },
    );

    if (!result.ok) {
      // Left `processing`: the retry, a visibility timeout later, finds the
      // claim dead and takes it again.
      if (!lastAttempt) return "retry";
      if (!(await finish("failed", { explanation_error: result.errorCode })).applied) return superseded();
      await archive(msg_id);
      return "failed";
    }

    // SM-REQ-002: a run that lost its claim doesn't charge. Checked just
    // before the charge; the save below is guarded too, and a charge in the
    // gap between them is the same idempotent unit (by row) that the newer
    // run pays.
    const { data: stillOurs, error: claimError } = await admin
      .from("job_relevant_profiles")
      .select("id")
      .eq("id", row.id)
      .eq("explanation_status", "processing")
      .eq("claimed_at", claimedAt)
      .maybeSingle();
    if (claimError) throw new Error(`Claim check failed: ${claimError.message}`);
    if (!stillOurs) return superseded();

    // Same ref as the on-demand route, so a "Why?" for this row, or a retried
    // message, isn't charged twice.
    try {
      // The weekly digest's explanations: the system's work, so no actor (RP-REQ-043).
      await consumeEntitlement(
        job.company_id,
        "match_explanations",
        1,
        { type: "match_explanation", id: row.id },
        null,
      );
    } catch (err) {
      if (!(err instanceof EntitlementError)) throw err;
      await finish("skipped_quota");
      await archive(msg_id);
      return "done";
    }

    const { applied: saved } = await finish("completed", {
      explanation: result.explanation as unknown as Json,
      explanation_error: null,
      explained_at: new Date().toISOString(),
    });
    if (!saved) return superseded();

    await archive(msg_id);
    return "done";
  };

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const message of messages) {
    try {
      const outcome = await process(message);
      if (outcome === "done") {
        processed++;
      } else if (outcome === "busy") {
        skipped++;
      } else {
        failed++;
        failures.push(`${message.message?.jobPostId}/${message.message?.userId}: ${outcome}`);
      }
    } catch (err) {
      failed++;
      failures.push(
        `${message.message?.jobPostId}/${message.message?.userId}: ${err instanceof Error ? err.message : "error"}`,
      );
      reportError(`[match explanations worker] message ${message.msg_id} failed`, err);

      // Don't retry a message that keeps throwing forever.
      if (message.read_ct >= MATCH_MAX_ATTEMPTS) {
        try {
          await admin
            .from("job_relevant_profiles")
            .update({ explanation_status: "failed", explanation_error: "worker_error" })
            .eq("job_posting_id", message.message?.jobPostId)
            .eq("user_id", message.message?.userId)
            .neq("explanation_status", "completed")
            // A newer run's live claim decides that row (SM-REQ-003).
            .or(
              notUnderLiveClaim({
                column: "explanation_status",
                claim: claimedAt,
                liveForMs: VISIBILITY_TIMEOUT * 1000,
              }),
            );
          await archive(message.msg_id);
        } catch (giveUpError) {
          reportError(`[match explanations worker] couldn't give up on ${message.msg_id}`, giveUpError);
        }
      }
    }
  }

  if (failed > 0) {
    await sendEmailForStatusUpdate(
      `[MATCH EXPLANATIONS] ${failed} of ${messages.length} failed this run:\n${failures.join("\n")}`,
    );
  }

  return NextResponse.json({ processed, failed, ...(skipped > 0 ? { skipped } : {}) });
}
