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
  aiCredits = 0,
  matchedJobIds,
  isJobDigest,
}: {
  initialJobs: IJob[];
  initialCount: number;
  userId?: string;
  aiCredits?: number;
  matchedJobIds: string[];
  isJobDigest: boolean;
}): Promise<RerankResult> {
  let finalJobs = initialJobs;
  let finalCount = initialCount;

  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const url = `${protocol}://${host}`;

  if (!userId || !finalJobs || finalJobs.length === 0) {
    return { initialJobs: finalJobs, totalCount: finalCount };
  }

  // --- 1. Check AI Credits ---
  const requiredCredits = TAICredits.AI_SMART_SEARCH_OR_ASK_AI;

  if (aiCredits >= requiredCredits || isJobDigest) {
    try {
      const requestHeaders: Record<string, string> = {};
      if (isJobDigest && INTERNAL_API_SECRET) {
        requestHeaders["X-Internal-Secret"] = INTERNAL_API_SECRET;
      } else {
        const cookie = headersList.get("Cookie");
        if (cookie) {
          requestHeaders["Cookie"] = cookie;
        }
      }
      const aiRerankRes = await fetch(`${url}/api/ai-search/jobs`, {
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
            description: job.description,
            visa_requirement: job.visa_requirement,
            salary_range: job.salary_range,
            locations: job.locations,
            experience: job.experience,
          })),
        }),
      });

      const aiRerankResult: {
        rerankedJobs: string[];
        filteredOutJobs: string[];
      } = await aiRerankRes.json();

      if (aiRerankRes.ok && aiRerankResult.rerankedJobs) {
        const rerankedIds = aiRerankResult.rerankedJobs;
        const filteredOutIds = aiRerankResult.filteredOutJobs || [];

        const jobMap = new Map(initialJobs.map((job: IJob) => [job.id, job]));

        const reorderedJobs = rerankedIds
          .map((id: string) => jobMap.get(id))
          .filter(
            (job: IJob | undefined): job is IJob =>
              job !== undefined && !filteredOutIds.includes(job.id)
          );

        finalJobs = reorderedJobs;
        finalCount = reorderedJobs.length;
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
