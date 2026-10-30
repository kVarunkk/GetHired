import { reportError } from "@/helpers/posthog/report-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { AllJobWithRelations, TAICredits } from "../../utils/types";
import {
  rerankJobsForUser,
  rerankSimilarJobs,
} from "@/helpers/jobs/rerank-jobs";

interface RerankResult {
  initialJobs: AllJobWithRelations[];
  totalCount: number;
}

/**
 * Restores the vector order of a relevance search and, on its first page,
 * re-ranks the top 50 with AI (charging the user). Runs in-process with the
 * caller's client, so the agent and MCP need nothing from the request.
 */
export async function rerankJobsIfApplicable(
  supabase: SupabaseClient<Database>,
  {
    initialJobs,
    initialCount,
    userId,
    jobId,
    aiCredits = 0,
    matchedJobIds,
    relevanceSearchType,
    cursor,
  }: {
    initialJobs: AllJobWithRelations[];
    initialCount: number;
    userId?: string;
    jobId: string | null;
    aiCredits?: number;
    matchedJobIds: string[];
    relevanceSearchType:
      | "standard"
      | "job_digest"
      | "job_digest_with_suggestions"
      | "similar_jobs"
      | null;
    cursor: string | null;
  },
): Promise<RerankResult> {
  let finalCount = initialCount;
  let removedJobs: AllJobWithRelations[] = [];

  const requiredCredits = TAICredits.AI_SEARCH_ASK_AI_RESUME;

  // Restore vector similarity order first
  if (matchedJobIds.length > 0) {
    const jobMap = new Map(initialJobs.map((job) => [job.id, job]));
    initialJobs = matchedJobIds
      .map((id) => jobMap.get(id))
      .filter((job): job is AllJobWithRelations => !!job);
  }
  let finalJobs = initialJobs;

  if (
    cursor ||
    !finalJobs ||
    finalJobs.length === 0 ||
    !userId ||
    !relevanceSearchType ||
    relevanceSearchType === "standard" ||
    (relevanceSearchType === "similar_jobs" && !jobId) ||
    aiCredits < requiredCredits
  ) {
    return { initialJobs, totalCount: finalCount };
  }

  try {
    // only keep top 50 jobs in toRerank (sent to AI for filtering) and the rest in removedJobs (concatenated later).
    const toRerank = initialJobs.slice(0, 50);
    removedJobs = initialJobs.slice(50);
    const jobs = toRerank.map(
      (job) =>
        ({
          id: job.id,
          job_name: job.job_name,
          description: job.description?.slice(0, 400),
          visa_requirement: job.visa_requirement,
          salary_range: job.salary_range,
          locations: job.locations,
          experience: job.experience,
        }) as AllJobWithRelations,
    );

    const aiRerankResult =
      relevanceSearchType === "similar_jobs"
        ? await rerankSimilarJobs(supabase, { userId, jobId: jobId!, jobs })
        : await rerankJobsForUser(supabase, {
            userId,
            jobs,
            type: relevanceSearchType,
          });

    if (aiRerankResult?.rerankedJobs) {
      const filteredOutIdsSet = new Set(aiRerankResult.filteredOutJobs || []);
      const jobMap = new Map(toRerank.map((job) => [job.id, job]));

      if (
        relevanceSearchType === "job_digest_with_suggestions" &&
        aiRerankResult.rerankedJobs.length > 0 &&
        typeof aiRerankResult.rerankedJobs[0] === "object"
      ) {
        // New shape: [{ id, reason }]
        const rerankedWithReasons = aiRerankResult.rerankedJobs as {
          id: string;
          reason?: string;
        }[];

        const uniqueSeen = new Set<string>();
        const reorderedJobs = rerankedWithReasons
          .filter(({ id }) => {
            if (uniqueSeen.has(id) || filteredOutIdsSet.has(id)) return false;
            uniqueSeen.add(id);
            return true;
          })
          .map(({ id, reason }) => {
            const job = jobMap.get(id);
            if (!job) return null;
            return { ...job, match_reason: reason };
          })
          .filter(
            (
              job,
            ): job is AllJobWithRelations & {
              match_reason: string | undefined;
            } => !!job,
          );

        finalJobs = reorderedJobs;
        finalCount = reorderedJobs.length;
      } else {
        // Old shape: string[]
        const uniqueRerankedIds = Array.from(
          new Set(aiRerankResult.rerankedJobs as string[]),
        );

        const reorderedJobs = uniqueRerankedIds
          .map((id: string) => jobMap.get(id))
          .filter(
            (job): job is AllJobWithRelations =>
              !!job && !filteredOutIdsSet.has(job.id),
          )
          .concat(removedJobs);

        finalJobs = reorderedJobs;
        finalCount = reorderedJobs.length;
      }
    }
  } catch (e) {
    reportError("Error during AI rerank:", e);
  }

  return { initialJobs: finalJobs, totalCount: finalCount };
}
