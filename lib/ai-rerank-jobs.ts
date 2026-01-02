import { headers } from "next/headers";
import { IJob, TAICredits } from "./types";

interface RerankResult {
  initialJobs: IJob[];
  totalCount: number;
}

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

export async function rerankJobsIfApplicable({
  initialJobs,
  initialCount,
  userId,
  jobId,
  aiCredits = 0,
  matchedJobIds,
  relevanceSearchType,
}: {
  initialJobs: IJob[];
  initialCount: number;
  userId?: string;
  jobId: string | null;
  aiCredits?: number;
  matchedJobIds: string[];
  relevanceSearchType: "standard" | "job_digest" | "similar_jobs" | null;
}): Promise<RerankResult> {
  let finalJobs = initialJobs;
  let finalCount = initialCount;
  let removedJobs: IJob[] = [];

  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const url = `${protocol}://${host}`;

  if (
    !finalJobs ||
    finalJobs.length === 0 ||
    !relevanceSearchType ||
    relevanceSearchType === "standard" ||
    (relevanceSearchType === "similar_jobs" && !jobId)
  ) {
    return { initialJobs: finalJobs, totalCount: finalCount };
  }

  // --- 1. Check AI Credits ---
  const requiredCredits = TAICredits.AI_SEARCH_OR_ASK_AI;

  if (aiCredits >= requiredCredits || relevanceSearchType === "job_digest") {
    try {
      const requestHeaders: Record<string, string> = {};
      if (relevanceSearchType === "job_digest" && INTERNAL_API_SECRET) {
        requestHeaders["X-Internal-Secret"] = INTERNAL_API_SECRET;
        removedJobs = initialJobs.splice(40);
      } else {
        const cookie = headersList.get("Cookie");
        if (cookie) {
          requestHeaders["Cookie"] = cookie;
        }
      }
      // console.log("AI RERANK FETCH CALL");
      const aiRerankRes = await fetch(
        `${url}/api/ai-search/jobs${
          relevanceSearchType === "similar_jobs" ? "/similar-jobs" : ""
        }`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...requestHeaders,
          },
          body: JSON.stringify({
            userId: userId,
            jobs: initialJobs.map((job: IJob) => ({
              id: job.id,
              job_name: job.job_name,
              description: job.description?.slice(0, 400),
              visa_requirement: job.visa_requirement,
              salary_range: job.salary_range,
              locations: job.locations,
              experience: job.experience,
            })),
            ...(relevanceSearchType === "similar_jobs"
              ? { jobId: jobId, aiCredits }
              : {}),
          }),
        }
      );

      const aiRerankResult: {
        rerankedJobs: string[];
        filteredOutJobs: string[];
      } = await aiRerankRes.json();

      if (aiRerankRes.ok && aiRerankResult.rerankedJobs) {
        const uniqueRerankedIds = Array.from(
          new Set(aiRerankResult.rerankedJobs as string[])
        );
        const filteredOutIdsSet = new Set(aiRerankResult.filteredOutJobs || []);

        const jobMap = new Map(initialJobs.map((job: IJob) => [job.id, job]));

        const reorderedJobs = uniqueRerankedIds
          .map((id: string) => jobMap.get(id))
          .filter(
            (job: IJob | undefined): job is IJob =>
              // Ensure the job exists in our map and hasn't been explicitly filtered out
              job !== undefined && !filteredOutIdsSet.has(job.id)
          )
          .concat(removedJobs);

        finalJobs = reorderedJobs;
        finalCount = reorderedJobs.length;

        // console.log("AI RERANK FETCH SUCCESS", finalJobs.length);
      }
    } catch (e) {
      console.error("Error during AI Rerank fetch:", e);
    }
  } else if (
    // --- 2. Handle Insufficient Credits Case ---
    aiCredits < requiredCredits &&
    matchedJobIds // Assuming the initial search response includes pre-matched IDs
  ) {
    const jobMap = new Map(initialJobs.map((job: IJob) => [job.id, job]));

    finalJobs = matchedJobIds
      .map((id: string) => jobMap.get(id))
      .filter((job: IJob | undefined): job is IJob => job !== undefined);

    finalCount = finalJobs.length || 0;
  }

  // --- 3. Return Final Result ---
  return { initialJobs: finalJobs, totalCount: finalCount };
}
