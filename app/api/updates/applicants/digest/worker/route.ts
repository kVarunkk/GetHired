import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  INTERNAL_API_SECRET,
  sendEmailForStatusUpdate,
} from "@/utils/serverUtils";
import {
  processUserDigest,
  sendJobDigestEmail,
} from "@/helpers/jobs/digest-utils";

export type RelevanceJobMessage = {
  msg_id: number;
  message: {
    user_id: string;
    email: string;
    full_name: string | null;
    ai_credits: number;
  };
};

const BATCH_SIZE = 5;
const VISIBILITY_TIMEOUT = 60; // seconds before a failed message is requeued

export async function GET() {
  const headersList = await headers();
  const cronSecret = headersList.get("X-Internal-Secret");
  if (cronSecret !== INTERNAL_API_SECRET) {
    return NextResponse.json(
      { message: "Unauthorized access" },
      { status: 401 },
    );
  }

  const digestDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const supabase = createServiceRoleClient();

  try {
    // Dequeue a batch of messages
    const { data: messages, error } = (await supabase
      .schema("pgmq_public")
      .rpc("read", {
        queue_name: "job_digest",
        sleep_seconds: VISIBILITY_TIMEOUT,
        n: BATCH_SIZE,
      })) as { data: RelevanceJobMessage[] | null; error: Error | null };

    if (error) {
      await sendEmailForStatusUpdate(
        `JOB DIGEST WORKER: Failed to read queue.\n${error.message}`,
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
        const { email, full_name } = msg.message;

        const result = await processUserDigest(msg.message);

        if (result.success) {
          // Delete message from queue on success
          await supabase.schema("pgmq_public").rpc("delete", {
            queue_name: "job_digest",
            message_id: msg.msg_id,
          });

          await sendJobDigestEmail(
            email,
            full_name!,
            result.jobs || [],
            digestDate,
            result.isInsufficientCredits,
          );
        }
        // On failure: message stays in queue, becomes visible again after VISIBILITY_TIMEOUT

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
    const errorMsg = error instanceof Error ? error.message : String(error);
    await sendEmailForStatusUpdate(
      `JOB DIGEST WORKER CRITICAL FAILURE:\n${errorMsg}`,
    );
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 },
    );
  }
}
