import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  INTERNAL_API_SECRET,
  sendEmailForStatusUpdate,
} from "@/utils/serverUtils";
import { parseResume } from "@/helpers/resume/parse-resume";
import { revalidateCacheAction } from "@/app/actions/revalidate";
import { processUserRelevance } from "@/helpers/jobs/relevant-jobs-utils";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";

export type OnboardingMessage = {
  msg_id: number;
  read_ct: number;
  message: {
    userId: string;
    resumeId: string;
    shouldParse: boolean;
  };
};

const BATCH_SIZE = 2;
const VISIBILITY_TIMEOUT = 60;
const MAX_RETRIES = 3;

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
        queue_name: "onboarding_pipeline",
        sleep_seconds: VISIBILITY_TIMEOUT,
        n: BATCH_SIZE,
      })) as { data: OnboardingMessage[] | null; error: Error | null };

    if (error) {
      await sendEmailForStatusUpdate(
        `ONBOARDING WORKER: Failed to read queue.\n${error.message}`,
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
        try {
          const { userId, resumeId, shouldParse } = msg.message;

          if (msg.read_ct >= MAX_RETRIES) {
            await supabase.schema("pgmq_public").rpc("delete", {
              queue_name: "onboarding_pipeline",
              message_id: msg.msg_id,
            });
            await sendEmailForStatusUpdate(
              `ONBOARDING WORKER POISON ALERT: Message ${msg.msg_id} for User ${userId} dropped after failing ${msg.read_ct} times.`,
            );
            return;
          }

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
                await revalidateCacheAction(`profile-${userId}`);
              }
            } catch {
              throw new Error("Resume Parsing Failed");
            }
          }

          // 2. UPDATE EMBEDDING

          const embedRes = await updateUserEmbedding(userId);
          if (embedRes.error) throw new Error("Background Embedding Failed");

          // 3. UPDATE USER INFO
          const { error: updateError } = await supabase
            .from("user_info")
            .update({
              relevant_jobs_update_status: "progress",
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId);

          if (updateError)
            throw new Error("Background User Info Update Failed");

          // 4. PROCESS USER RELEVANCE
          const relevanceRes = await processUserRelevance(userId, true);
          if (relevanceRes.error)
            throw new Error("Background User Relevance Failed");

          // Delete message from queue on success
          await supabase.schema("pgmq_public").rpc("delete", {
            queue_name: "onboarding_pipeline",
            message_id: msg.msg_id,
          });
        } catch (err) {
          console.log(err instanceof Error ? err.message : String(err));
          return;
        }
      }),
    );

    return NextResponse.json({
      success: true,
      message: `Processed ${results.length} messages.`,
    });
  } catch (error) {
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
