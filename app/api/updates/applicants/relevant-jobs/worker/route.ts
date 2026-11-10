import { reportError } from "@/helpers/posthog/report-error";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { processUserRelevance } from "@/helpers/jobs/relevant-jobs-utils";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { finishProfileRefresh } from "@/helpers/user/queue-profile-refresh";
import { transitionMany } from "@/helpers/db/transition";
import {
  RELEVANCE_JOBS_MAX_RETRIES as MAX_RETRIES,
  RELEVANCE_JOBS_QUEUE,
  RELEVANCE_JOBS_VISIBILITY_TIMEOUT_S as VISIBILITY_TIMEOUT,
} from "@/helpers/jobs/relevance-jobs-queue";

type RelevanceJobMessage = {
  msg_id: number;
  read_ct: number;
  message: {
    userId: string;
  };
};

const BATCH_SIZE = 5;

export async function GET() {
  const headersList = await headers();
  const cronSecret = headersList.get("X-Internal-Secret");
  if (cronSecret !== INTERNAL_API_SECRET) {
    return NextResponse.json(
      { message: "Unauthorized access" },
      { status: 401 },
    );
  }

  const supabase = createServiceRoleClient();

  try {
    const { data: messages, error } = (await supabase
      .schema("pgmq_public")
      .rpc("read", {
        queue_name: RELEVANCE_JOBS_QUEUE,
        sleep_seconds: VISIBILITY_TIMEOUT,
        n: BATCH_SIZE,
      })) as { data: RelevanceJobMessage[] | null; error: Error | null };

    if (error) {
      await sendEmailForStatusUpdate(
        `RELEVANCE WORKER: Failed to read queue.\n${error.message}`,
      );
      return NextResponse.json(
        { success: false, message: "Failed to read queue." },
        { status: 500 },
      );
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({ success: true, message: "Queue is empty." });
    }

    const results = await Promise.allSettled(
      messages.map(async (msg) => {
        const { userId } = msg.message;
        // Profile changes during this run get a follow-up (finishProfileRefresh).
        const startedAt = new Date().toISOString();

        const result = await processUserRelevance(userId, true);

        if (result.success) {
          await supabase.schema("pgmq_public").rpc("delete", {
            queue_name: RELEVANCE_JOBS_QUEUE,
            message_id: msg.msg_id,
          });
          await finishProfileRefresh(userId, startedAt);
        } else {
          console.warn(
            `[WORKER] Message ${msg.msg_id} failed. Attempt count: ${msg.read_ct}`,
          );

          // A failed attempt with retries left keeps the status (SM-REQ-013);
          // only giving up writes `failed`, from `progress`: a cron run of a
          // feed that was already `completed` leaves it as it was.
          if (msg.read_ct >= MAX_RETRIES) {
            await transitionMany(
              supabase,
              "user_info",
              { key: "user_id", ids: [userId], column: "relevant_jobs_update_status" },
              {
                from: ["progress"],
                to: "failed",
                patch: { updated_at: new Date().toISOString() },
              },
            ).catch((err) => reportError("[relevant jobs worker] couldn't mark the user failed", err));

            reportError(
              `[WORKER] Message ${msg.msg_id} exceeded max retries (${MAX_RETRIES}). Evicting...`,
            );

            await supabase.schema("pgmq_public").rpc("delete", {
              queue_name: RELEVANCE_JOBS_QUEUE,
              message_id: msg.msg_id,
            });

            await sendEmailForStatusUpdate(
              `JOB WORKER POISON ALERT: Message ${msg.msg_id} for User ${userId} dropped after failing ${msg.read_ct} times.`,
            );
          }
        }

        return { ...result, msgId: msg.msg_id };
      }),
    );

    const successful = results.filter(
      (r) => r.status === "fulfilled" && r.value.success,
    ).length;
    const failed = results.length - successful;

    return NextResponse.json({
      success: true,
      message: `Processed ${results.length} messages. Success: ${successful}, Failed: ${failed}.`,
    });
  } catch (error) {
    reportError("[relevant jobs worker] critical failure", error);
    const errorMsg =
      error instanceof Error ? error.message : "unknown error occured.";
    await sendEmailForStatusUpdate(
      `JOB RELEVANCE WORKER CRITICAL FAILURE:\n${errorMsg}`,
    );
    return NextResponse.json(
      { success: false, message: errorMsg },
      { status: 500 },
    );
  }
}
