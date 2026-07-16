import { headers } from "next/headers";
import { AllJobWithRelations, TAICredits } from "../../utils/types";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { getBaseUrl } from "@/utils/get-base-url";

interface RerankResult {
  initialJobs: AllJobWithRelations[];
  totalCount: number;
}

export async function rerankJobsIfApplicable({
  initialJobs,
  initialCount,
  userId,
  jobId,
  aiCredits = 0,
  matchedJobIds,
  relevanceSearchType,
  cursor,
  isInternalCall,
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
  isInternalCall: boolean;
}): Promise<RerankResult> {
  let finalJobs = initialJobs;
  let finalCount = initialCount;
  let removedJobs: AllJobWithRelations[] = [];

  const headersList = await headers();
  // const host = headersList.get("host");
  // const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  // const url = `${protocol}://${host}`;
  const url = await getBaseUrl();

  const requiredCredits = TAICredits.AI_SEARCH_ASK_AI_RESUME;

  // Restore vector similarity order first
  if (matchedJobIds.length > 0) {
    const jobMap = new Map(initialJobs.map((job) => [job.id, job]));
    initialJobs = matchedJobIds
      .map((id) => jobMap.get(id))
      .filter((job): job is AllJobWithRelations => !!job);
  }

  if (
    cursor ||
    !finalJobs ||
    finalJobs.length === 0 ||
    !relevanceSearchType ||
    relevanceSearchType === "standard" ||
    (relevanceSearchType === "similar_jobs" && !jobId) ||
    aiCredits < requiredCredits
  ) {
    return { initialJobs, totalCount: finalCount };
  }

  try {
    // const requestHeaders: Record<string, string> = {};
    // if (relevanceSearchType !== "similar_jobs") {
    //   requestHeaders["X-Internal-Secret"] = INTERNAL_API_SECRET;
    // }

    // const cookie = headersList.get("Cookie");
    // if (cookie) {
    //   requestHeaders["Cookie"] = cookie;
    // }

    const requestHeaders: Record<string, string> = {};
    const cookie = headersList.get("Cookie");
    const authHeader = headersList.get("Authorization");

    if (isInternalCall) {
      requestHeaders["X-Internal-Secret"] = INTERNAL_API_SECRET;
    } else if (cookie) {
      requestHeaders["Cookie"] = cookie;
    } else if (authHeader) {
      // for stdio mcp gh token
      requestHeaders["Authorization"] = authHeader;
    }

    // only keep top 20 jobs in initialJobs(will be sent to AI for filtering) and rest in removedJobs(will be concatenated later).
    removedJobs = initialJobs.splice(20);
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
          jobs: initialJobs.map((job) => ({
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
            : {
                type: relevanceSearchType,
              }),
        }),
      },
    );

    const aiRerankResult: {
      rerankedJobs: string[] | { id: string; reason?: string }[];
      filteredOutJobs: string[];
    } = await aiRerankRes.json();

    if (aiRerankRes.ok && aiRerankResult.rerankedJobs) {
      const filteredOutIdsSet = new Set(aiRerankResult.filteredOutJobs || []);
      const jobMap = new Map(initialJobs.map((job) => [job.id, job]));

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
    console.error("Error during AI Rerank fetch:", e);
  }

  return { initialJobs: finalJobs, totalCount: finalCount };
}
