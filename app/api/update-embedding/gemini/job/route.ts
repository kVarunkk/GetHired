import { NextResponse } from "next/server";
import { embedMany } from "ai";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { google } from "@ai-sdk/google";

const VISIBILITY_TIMEOUT = 300;
const BATCH_SIZE = 50;

type JobEmbeddingMessage = {
  msg_id: number;
  message: {
    id: string;
    table?: string | null;
  };
};

type EmbeddingTable = "all_jobs" | "job_postings";

export async function POST(request: Request) {
  const headersList = await headers();
  const cronSecret = headersList.get("X-Internal-Secret");

  if (cronSecret !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceRoleClient();

    // 1. Read a batch of messages from pgmq
    // vt (visibility timeout) = 300 seconds (locks messages so other workers won't grab them while processing)
    const { data, error: readError } = await supabase.schema("pgmq_public").rpc("read", {
      queue_name: "job_embeddings_queue",
      sleep_seconds: VISIBILITY_TIMEOUT,
      n: BATCH_SIZE,
    });

    if (readError) {
      console.error("Error reading from pgmq:", readError);
      return NextResponse.json({ error: "Failed to read queue." }, { status: 500 });
    }

    const messages = data as JobEmbeddingMessage[] | null;

    if (!messages || messages.length === 0) {
      return NextResponse.json({ message: "No jobs in queue to process.", processed: 0 });
    }

    const tableByMessageId = new Map<number, EmbeddingTable>();
    for (const message of messages) {
      if (!message.message?.id) {
        throw new Error(`Queue message ${message.msg_id} is missing a job ID.`);
      }

      const table = message.message.table ?? "all_jobs";
      if (table !== "all_jobs" && table !== "job_postings") {
        throw new Error(`Queue message ${message.msg_id} has unsupported table "${table}".`);
      }
      tableByMessageId.set(message.msg_id, table);
    }

    const jobIds = [...new Set(messages.map((message) => message.message.id))];

    // 2. Fetch all corresponding job profiles in a single query
    const { data: jobs, error: fetchError } = await supabase
      .from("all_jobs")
      .select("id, job_name, description, locations, job_type, salary_range")
      .in("id", jobIds);

    if (fetchError) {
      throw new Error(`Failed to fetch job records from database: ${fetchError.message}`);
    }

    if (!jobs || jobs.length === 0) {
      throw new Error("No job records were found for the queue messages.");
    }

    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const jobsInMessageOrder = messages.map((message) => {
      const job = jobsById.get(message.message.id);
      if (!job) {
        throw new Error(`Job ${message.message.id} was not found in all_jobs.`);
      }
      return job;
    });

    // 3. Format text payloads for embedding
    const textsToEmbed = jobsInMessageOrder.map((job) => `
      ROLE: ${job.job_name || "N/A"}
      LOCATION: ${Array.isArray(job.locations) ? job.locations.join(", ") : job.locations || ""}
      DETAILED DESCRIPTION: ${job.description || "N/A"}
      TYPE: ${job.job_type || "N/A"}
      COMPENSATION: ${job.salary_range || "N/A"}
    `.trim());

    // 4. Generate embeddings in bulk via Vercel AI SDK
    const model = google.embedding("gemini-embedding-001");
    const { embeddings } = await embedMany({
      model: model,
      values: textsToEmbed,
      providerOptions: {
        google: {
          outputDimensionality: 768,
        },
      },
    });

    // 5. Update Supabase with the generated embeddings
    let processedCount = 0;
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const table = tableByMessageId.get(message.msg_id)!;
      const updatedAt = new Date().toISOString();
      const embedding = `[${embeddings[i].join(",")}]`;
      const embeddingUpdate = {
        embedding_new: embedding,
        updated_at: updatedAt,
        ...(table === "job_postings" && { embedding_updated_at: updatedAt }),
      };
      const { error: updateError } =
        table === "job_postings"
          ? await supabase
              .from("job_postings")
              .update(embeddingUpdate)
              .eq("id", message.message.id)
          : await supabase
              .from("all_jobs")
              .update(embeddingUpdate)
              .eq("id", message.message.id);

      if (updateError) {
        throw new Error(
          `Failed to update embedding for job ${message.message.id}: ${updateError.message}`,
        );
      }

      // Delete each message only after its corresponding row has been updated.
      const { error: deleteError } = await supabase.schema("pgmq_public").rpc("delete", {
        queue_name: "job_embeddings_queue",
        message_id: message.msg_id,
      });

      if (deleteError) {
        throw new Error(
          `Failed to delete processed queue message ${message.msg_id}: ${deleteError.message}`,
        );
      }

      processedCount++;
    }

    return NextResponse.json({
      message: `Successfully processed batch of ${processedCount} job embeddings via pgmq.`,
      processed_count: processedCount,
    });
  } catch (error) {
    console.error("Error in batch embedding route:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}