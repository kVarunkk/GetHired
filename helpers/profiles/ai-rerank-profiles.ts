import { headers } from "next/headers";
import { AllProfileWithRelations } from "../../utils/types";
import { INTERNAL_API_SECRET } from "@/utils/serverUtils";

interface RerankResult {
  initialProfiles: AllProfileWithRelations[];
  totalCount: number;
}

export async function rerankProfilesIfApplicable({
  initialProfiles,
  initialCount,
  userId,
  jobId,
  relevanceSearchType,
  cursor,
  companyId,
  isInternalCall,
}: {
  initialProfiles: AllProfileWithRelations[];
  initialCount: number;
  userId: string;
  jobId: string | null;
  aiCredits: number;
  matchedProfileIds: string[];
  cursor: string | null;
  companyId: string;
  relevanceSearchType: "digest" | "standard" | null;
  isInternalCall: boolean;
}): Promise<RerankResult> {
  let finalProfiles = initialProfiles;
  let finalCount = initialCount;
  let removedProfiles: AllProfileWithRelations[] = [];

  const headersList = await headers();
  const host = headersList.get("host");
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
  const url = `${protocol}://${host}`;

  if (
    cursor ||
    !finalProfiles ||
    finalProfiles.length === 0 ||
    !relevanceSearchType ||
    relevanceSearchType === "standard" ||
    (relevanceSearchType === "digest" && !jobId)
  ) {
    return { initialProfiles: finalProfiles, totalCount: finalCount };
  }

  try {
    const requestHeaders: Record<string, string> = {};
    const cookie = headersList.get("Cookie");

    if (isInternalCall) {
      requestHeaders["X-Internal-Secret"] = INTERNAL_API_SECRET;
    } else if (cookie) {
      requestHeaders["Cookie"] = cookie;
    }
    removedProfiles = initialProfiles.splice(20);

    const aiRerankRes = await fetch(`${url}/api/ai-search/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...requestHeaders,
      },
      body: JSON.stringify({
        userId: userId,
        jobId,
        companyId,
        profiles: initialProfiles.map((profile) => {
          const resumeContent = profile.resumes?.[0]?.content as
            | { experience?: string; skills?: string; projects?: string }
            | undefined;

          return {
            user_id: profile.user_id,
            full_name: profile.full_name,
            desired_roles: profile.desired_roles,
            experience_years: profile.experience_years,
            preferred_locations: profile.preferred_locations,
            top_skills: profile.top_skills,
            work_style_preferences: profile.work_style_preferences,
            company_size_preference: profile.company_size_preference,
            career_goals_short_term: profile.career_goals_short_term,
            career_goals_long_term: profile.career_goals_long_term,
            job_type: profile.job_type,
            industry_preferences: profile.industry_preferences,
            resume_experience: resumeContent?.experience ?? "",
            resume_skills: resumeContent?.skills ?? "",
            resume_projects: resumeContent?.projects ?? "",
          };
        }),
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

      const jobMap = new Map(initialProfiles.map((job) => [job.user_id, job]));

      const reorderedJobs = uniqueRerankedIds
        .map((id: string) => jobMap.get(id))
        .filter(
          (job): job is AllProfileWithRelations =>
            !!job && !filteredOutIdsSet.has(job.user_id),
        )
        .concat(removedProfiles);

      finalProfiles = reorderedJobs;
      finalCount = reorderedJobs.length;
    }
  } catch (e) {
    console.error("Error during AI Rerank fetch:", e);
  }

  return { initialProfiles: finalProfiles, totalCount: finalCount };
}
