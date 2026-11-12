import { reportError } from "@/helpers/posthog/report-error";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { parseResume } from "@/helpers/resume/parse-resume";
import { revalidateTag } from "next/cache";
import { processUserRelevance } from "@/helpers/jobs/relevant-jobs-utils";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { finishProfileRefresh } from "@/helpers/user/queue-profile-refresh";
import { transitionMany } from "@/helpers/db/transition";
import {
  ONBOARDING_MAX_RETRIES as MAX_RETRIES,
  ONBOARDING_QUEUE,
  ONBOARDING_VISIBILITY_TIMEOUT_S as VISIBILITY_TIMEOUT,
} from "@/helpers/jobs/relevance-jobs-queue";

export type OnboardingMessage = {
  msg_id: number;
  read_ct: number;
  message: {
    userId: string;
    /** Absent when a profile change (queue_profile_refresh) queued the run. */
    resumeId?: string | null;
    shouldParse: boolean;
  };
};

const BATCH_SIZE = 2;

/** Gives up on the user's run: `failed` from `progress` only (SM-REQ-013). */
async function markFailed(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
) {
  await transitionMany(
    supabase,
    "user_info",
    { key: "user_id", ids: [userId], column: "relevant_jobs_update_status" },
    {
      from: ["progress"],
      to: "failed",
      patch: { updated_at: new Date().toISOString() },
    },
  ).catch((err) => reportError("[onboarding worker] couldn't mark the user failed", err));
}

async function dropMessage(
  supabase: ReturnType<typeof createServiceRoleClient>,
  msg: OnboardingMessage,
) {
  await markFailed(supabase, msg.message.userId);
  await supabase.schema("pgmq_public").rpc("delete", {
    queue_name: ONBOARDING_QUEUE,
    message_id: msg.msg_id,
  });
  await sendEmailForStatusUpdate(
    `ONBOARDING WORKER POISON ALERT: Message ${msg.msg_id} for User ${msg.message.userId} dropped after failing ${msg.read_ct} times.`,
  );
}

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
        queue_name: ONBOARDING_QUEUE,
        sleep_seconds: VISIBILITY_TIMEOUT,
        n: BATCH_SIZE,
      })) as { data: OnboardingMessage[] | null; error: Error | null };

    if (error) {
      // await sendEmailForStatusUpdate(
      //   `ONBOARDING WORKER: Failed to read queue.\n${error.message}`,
      // );
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
        try {
          const { userId, resumeId, shouldParse } = msg.message;

          // Only a message whose run never finished (a crash or timeout)
          // gets here: a failed attempt is handled in the catch below.
          if (msg.read_ct > MAX_RETRIES) {
            await dropMessage(supabase, msg);
            return;
          }

          // A change after this moment isn't in this run (it reads the
          // profile below), so finishProfileRefresh queues a follow-up for it.
          const startedAt = new Date().toISOString();

          // 1. PARSE RESUME
          if (shouldParse && resumeId) {
            try {
              // idempotency check
              const { data: resume } = await supabase
                .from("resumes")
                .select("content")
                .eq("id", resumeId)
                .single();
              if (!resume?.content) {
                await parseResume(userId, resumeId);
                revalidateTag(`profile-${userId}`);
              }
            } catch {
              throw new Error("Resume Parsing Failed");
            }
          }

          // 2. UPDATE EMBEDDING

          const embedRes = await updateUserEmbedding(userId);
          if (embedRes.error) throw new Error("Background Embedding Failed");

          // 3. MARK THE RUN. The RPC that queued this message
          // (complete_applicant_onboarding, queue_profile_refresh) already
          // started it, so a `progress` row is this run's and keeps its start
          // time. Only a finished state (e.g. a cron run completed meanwhile)
          // moves back, and the database stamps a new start (SM-REQ-004/005).
          try {
            await transitionMany(
              supabase,
              "user_info",
              { key: "user_id", ids: [userId], column: "relevant_jobs_update_status" },
              {
                from: ["pending", "failed", "completed"],
                to: "progress",
                patch: { updated_at: new Date().toISOString() },
              },
            );
          } catch {
            throw new Error("Background User Info Update Failed");
          }

          // 4. PROCESS USER RELEVANCE
          // The status stays "progress" while retries remain, so the jobs page
          // and the agent keep saying the matches are on their way.
          const relevanceRes = await processUserRelevance(userId, true);
          if (relevanceRes.error)
            throw new Error("Background User Relevance Failed");

          // Delete message from queue on success
          await supabase.schema("pgmq_public").rpc("delete", {
            queue_name: ONBOARDING_QUEUE,
            message_id: msg.msg_id,
          });

          // Profile changes made during this run get one more run.
          await finishProfileRefresh(userId, startedAt);
        } catch (err) {
          reportError("[onboarding worker] message failed", err);
          // Last attempt: give up now rather than on an extra read. Otherwise
          // the message reappears after the visibility timeout and is retried.
          if (msg.read_ct >= MAX_RETRIES) await dropMessage(supabase, msg);
          return;
        }
      }),
    );

    return NextResponse.json({
      success: true,
      message: `Processed ${results.length} messages.`,
    });
  } catch (error) {
    reportError("[onboarding worker] critical failure", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await sendEmailForStatusUpdate(
      `ONBOARDING WORKER CRITICAL FAILURE:\n${errorMsg}`,
    );
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 },
    );
  }
}
