import { headers } from "next/headers";
import { AllProfileWithRelations, TAICredits } from "../../utils/types";

interface RerankResult {
  initialProfiles: AllProfileWithRelations[];
  totalCount: number;
}

export async function rerankProfilesIfApplicable({
  initialProfiles,
  initialCount,
  userId,
  jobId,
  aiCredits,
  matchedProfileIds,
  isRelevantSearch,
  cursor,
  companyId,
}: {
  initialProfiles: AllProfileWithRelations[];
  initialCount: number;
  userId: string;
  jobId: string | null;
  aiCredits: number;
  matchedProfileIds: string[];
  isRelevantSearch: boolean;
  cursor: string | null;
  companyId: string;
}): Promise<RerankResult> {
  let finalJobs = initialProfiles;
  let finalCount = initialCount;
  let removedJobs: AllProfileWithRelations[] = [];

  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const url = `${protocol}://${host}`;

  if (
    cursor ||
    !finalJobs ||
    finalJobs.length === 0 ||
    !isRelevantSearch ||
    !jobId
  ) {
    return { initialProfiles: finalJobs, totalCount: finalCount };
  }

  const requiredCredits = TAICredits.AI_SEARCH_ASK_AI_RESUME;

  if (aiCredits >= requiredCredits) {
    try {
      const requestHeaders: Record<string, string> = {};

      const cookie = headersList.get("Cookie");
      if (cookie) {
        requestHeaders["Cookie"] = cookie;
      }

      const aiRerankRes = await fetch(`${url}/api/ai-search/profiles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...requestHeaders,
        },
        body: JSON.stringify({
          userId: userId,
          job_post_id: jobId,
          companyId,
          profiles: initialProfiles.map((profile) => ({
            user_id: profile.user_id,
            full_name: profile.full_name,
            desired_roles: profile.desired_roles,
            experience_years: profile.experience_years,
            preferred_locations: profile.preferred_locations,
            top_skills: profile.top_skills,
            work_style_preferences: profile.work_style_preferences,
          })),
        }),
      });

      const aiRerankResult: {
        rerankedProfiles: string[];
        filteredOutProfiles: string[];
      } = await aiRerankRes.json();

      if (aiRerankRes.ok && aiRerankResult.rerankedProfiles) {
        const uniqueRerankedIds = Array.from(
          new Set(aiRerankResult.rerankedProfiles as string[]),
        );
        const filteredOutIdsSet = new Set(
          aiRerankResult.filteredOutProfiles || [],
        );

        const jobMap = new Map(
          initialProfiles.map((job) => [job.user_id, job]),
        );

        const reorderedJobs = uniqueRerankedIds
          .map((id: string) => jobMap.get(id))
          .filter(
            (job): job is AllProfileWithRelations =>
              !!job && !filteredOutIdsSet.has(job.user_id),
          )
          .concat(removedJobs);

        finalJobs = reorderedJobs;
        finalCount = reorderedJobs.length;
      }
    } catch (e) {
      console.error("Error during AI Rerank fetch:", e);
    }
  } else if (
    // --- 2. Handle Insufficient Credits Case ---
    aiCredits < requiredCredits &&
    matchedProfileIds // Assuming the initial search response includes pre-matched IDs from vector search
  ) {
    const jobMap = new Map(initialProfiles.map((job) => [job.user_id, job]));

    finalJobs = matchedProfileIds
      .map((id: string) => jobMap.get(id))
      .filter((job) => job !== undefined);

    finalCount = finalJobs.length || 0;
  }

  return { initialProfiles: finalJobs, totalCount: finalCount };
}
