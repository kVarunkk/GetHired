import { reportError } from "@/helpers/posthog/report-error";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { processJobPostingRelevance } from "@/helpers/profiles/relevant-profiles-utils";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { transition } from "@/helpers/db/transition";
import {
  RELEVANCE_PROFILES_MAX_RETRIES as MAX_RETRIES,
  RELEVANCE_PROFILES_QUEUE,
  RELEVANCE_PROFILES_VISIBILITY_TIMEOUT_S as VISIBILITY_TIMEOUT,
} from "@/helpers/profiles/relevance-queue";

type RelevanceJobMessage = {
  msg_id: number;
  read_ct: number;

  message: {
    userId: string;
    jobId: string;
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
    // Dequeue a batch of messages
    const { data: messages, error } = (await supabase
      .schema("pgmq_public")
      .rpc("read", {
        queue_name: RELEVANCE_PROFILES_QUEUE,
        sleep_seconds: VISIBILITY_TIMEOUT,
        n: BATCH_SIZE,
      })) as { data: RelevanceJobMessage[] | null; error: Error | null };

    if (error) {
      await sendEmailForStatusUpdate(
        `PROFILES RELEVANCE WORKER: Failed to read queue.\n${error.message}`,
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
        const { userId, jobId } = msg.message;

        const result = await processJobPostingRelevance(userId, jobId, true);

        if (result.success) {
          await supabase.schema("pgmq_public").rpc("delete", {
            queue_name: RELEVANCE_PROFILES_QUEUE,
            message_id: msg.msg_id,
          });
        } else {
          console.warn(
            `[WORKER] Message ${msg.msg_id} failed. Attempt count: ${msg.read_ct}`,
          );

          // A failed attempt with retries left keeps the job in progress
          // (SM-REQ-013); only giving up writes `failed` and emails.
          if (msg.read_ct >= MAX_RETRIES) {
            // A database error here still drops the message below: another
            // read would run (and pay for) the digest again. The job then
            // reads as a dead run once its timeout passes.
            await transition(
              supabase,
              "job_postings",
              { id: jobId, column: "matching_status" },
              {
                from: ["progress"],
                to: "failed",
                patch: {
                  matching_error: `Failed after ${msg.read_ct} attempts: ${result.error}`,
                  matched_at: new Date().toISOString(),
                },
              },
            ).catch((err) => reportError("[relevant profiles worker] couldn't mark the job failed", err));

            reportError(
              `[WORKER] Message ${msg.msg_id} exceeded max retries (${MAX_RETRIES}). Evicting...`,
            );

            await supabase.schema("pgmq_public").rpc("delete", {
              queue_name: RELEVANCE_PROFILES_QUEUE,
              message_id: msg.msg_id,
            });

            await sendEmailForStatusUpdate(
              `PROFILES WORKER POISON ALERT: Message ${msg.msg_id} for Job ${jobId} dropped after failing ${msg.read_ct} times.`,
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
    reportError("[relevant profiles worker] critical failure", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await sendEmailForStatusUpdate(
      `PROFILE RELEVANCE WORKER CRITICAL FAILURE:\n${errorMsg}`,
    );
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 },
    );
  }
}
