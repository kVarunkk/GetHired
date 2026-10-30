import "server-only";
import { embedMany } from "ai";
import { google } from "@ai-sdk/google";

/** The fields a job's embedding is built from, for both `all_jobs` and `job_postings`. */
export type EmbeddingJob = {
  job_name: string | null;
  description: string | null;
  locations: string[] | string | null;
  job_type: string | null;
  salary_range: string | null;
};

/** The text a job is embedded from. */
export function jobEmbeddingText(job: EmbeddingJob): string {
  return `
      ROLE: ${job.job_name || "N/A"}
      LOCATION: ${Array.isArray(job.locations) ? job.locations.join(", ") : job.locations || ""}
      DETAILED DESCRIPTION: ${job.description || "N/A"}
      TYPE: ${job.job_type || "N/A"}
      COMPENSATION: ${job.salary_range || "N/A"}
    `.trim();
}

/**
 * Embeds each job (Gemini, 768 dimensions) and returns the vectors as pgvector
 * literals, in the same order, ready for `embedding_new`.
 */
export async function embedJobs(jobs: EmbeddingJob[]): Promise<string[]> {
  const { embeddings } = await embedMany({
    model: google.embedding("gemini-embedding-001"),
    values: jobs.map(jobEmbeddingText),
    providerOptions: {
      google: {
        outputDimensionality: 768,
      },
    },
  });
  return embeddings.map((embedding) => `[${embedding.join(",")}]`);
}
