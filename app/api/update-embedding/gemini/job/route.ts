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

type EmbeddingJob = {
  id: string;
  job_name: string | null;
  description: string | null;
  locations: string[] | string | null;
  job_type: string | null;
  salary_range: string | null;
};

export async function POST() {
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

    const idsByTable: Record<EmbeddingTable, string[]> = {
      all_jobs: [],
      job_postings: [],
    };
    for (const message of messages) {
      idsByTable[tableByMessageId.get(message.msg_id)!].push(
        message.message.id,
      );
    }

    // Queue messages can refer to either source table; normalize their fields
    // before building embeddings.
    const jobsByMessageKey = new Map<string, EmbeddingJob>();
    const allJobIds = [...new Set(idsByTable.all_jobs)];
    if (allJobIds.length > 0) {
      const { data: jobs, error: fetchError } = await supabase
        .from("all_jobs")
        .select("id, job_name, description, locations, job_type, salary_range")
        .in("id", allJobIds);

      if (fetchError) {
        throw new Error(
          `Failed to fetch job records from all_jobs: ${fetchError.message}`,
        );
      }

      for (const job of jobs ?? []) {
        jobsByMessageKey.set(`all_jobs:${job.id}`, job);
      }
    }

    const postingIds = [...new Set(idsByTable.job_postings)];
    if (postingIds.length > 0) {
      const { data: postings, error: fetchError } = await supabase
        .from("job_postings")
        .select("id, title, description, location, job_type, salary_range")
        .in("id", postingIds);

      if (fetchError) {
        throw new Error(
          `Failed to fetch job records from job_postings: ${fetchError.message}`,
        );
      }

      for (const posting of postings ?? []) {
        jobsByMessageKey.set(`job_postings:${posting.id}`, {
          id: posting.id,
          job_name: posting.title,
          description: posting.description,
          locations: posting.location,
          job_type: posting.job_type,
          salary_range: posting.salary_range,
        });
      }
    }

    const processableMessages: JobEmbeddingMessage[] = [];
    const jobsInMessageOrder: EmbeddingJob[] = [];
    let skippedCount = 0;
    for (const message of messages) {
      const table = tableByMessageId.get(message.msg_id)!;
      const job = jobsByMessageKey.get(`${table}:${message.message.id}`);

      if (!job) {
        console.warn(
          `[EMBEDDING WORKER] Skipping stale queue message ${message.msg_id}: ${table} row ${message.message.id} no longer exists.`,
        );
        const { error: deleteError } = await supabase
          .schema("pgmq_public")
          .rpc("delete", {
            queue_name: "job_embeddings_queue",
            message_id: message.msg_id,
          });
        if (deleteError) {
          throw new Error(
            `Failed to delete stale queue message ${message.msg_id}: ${deleteError.message}`,
          );
        }
        skippedCount++;
        continue;
      }

      processableMessages.push(message);
      jobsInMessageOrder.push(job);
    }

    if (processableMessages.length === 0) {
      return NextResponse.json({
        message: `No existing jobs to embed. Skipped ${skippedCount} stale queue messages.`,
        processed_count: 0,
        skipped_count: skippedCount,
      });
    }

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
    for (let i = 0; i < processableMessages.length; i++) {
      const message = processableMessages[i];
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
      message: `Successfully processed ${processedCount} job embeddings and skipped ${skippedCount} stale queue messages.`,
      processed_count: processedCount,
      skipped_count: skippedCount,
    });
  } catch (error) {
    console.error("Error in batch embedding route:", error);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}