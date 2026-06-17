import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  deploymentUrl,
  INTERNAL_API_SECRET,
  sendEmailForRelevantJobsStatusUpdate,
  sendEmailForStatusUpdate,
} from "@/utils/serverUtils";
import { AllJobWithRelations } from "@/utils/types";

type RelevanceJobMessage = {
  msg_id: number;
  message: {
    userId: string;
    email: string;
    fullName: string;
  };
};

const URL = deploymentUrl();
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

  const supabase = createServiceRoleClient();

  try {
    // Dequeue a batch of messages
    const { data: messages, error } = (await supabase
      .schema("pgmq_public")
      .rpc("read", {
        queue_name: "relevance_jobs",
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
        const { userId, email, fullName } = msg.message;

        const result = await processUserRelevance(userId, email, fullName);

        if (result.success) {
          // Delete message from queue on success
          await supabase.schema("pgmq_public").rpc("delete", {
            queue_name: "relevance_jobs",
            message_id: msg.msg_id,
          });

          await sendEmailForRelevantJobsStatusUpdate(
            email,
            fullName,
            URL + "/jobs?sortBy=relevance",
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
      `RELEVANCE WORKER CRITICAL FAILURE:\n${errorMsg}`,
    );
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 },
    );
  }
}

async function processUserRelevance(
  userId: string,
  userEmail: string,
  fullName: string,
) {
  const supabase = createServiceRoleClient();

  try {
    const response = await fetch(
      `${URL}/api/jobs?sortBy=relevance&limit=100&createdAfter=30&userId=${userId}`,
      {
        headers: { "X-Internal-Secret": INTERNAL_API_SECRET || "" },
      },
    );

    if (!response.ok) throw new Error(`Jobs API returned ${response.status}`);

    const json = await response.json();
    const jobs: AllJobWithRelations[] = json.data || [];

    const rowsToInsert = jobs.map((job, index) => ({
      user_id: userId,
      jobs_id: job.id,
      relevance_rank: index + 1,
      updated_at: new Date().toISOString(),
    }));

    const { error: deleteError } = await supabase
      .from("user_relevant_jobs")
      .delete()
      .eq("user_id", userId);

    if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`);

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("user_relevant_jobs")
        .insert(rowsToInsert);

      if (insertError) throw new Error(`Insert failed: ${insertError.message}`);
    }

    await supabase
      .from("user_info")
      .update({
        is_relevant_jobs_generated: true,
        is_relevant_job_update_failed: false,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return { success: true, userEmail, fullName };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, userEmail, fullName, error: msg };
  }
}
