import { headers } from "next/headers";
import {
  AllProfileWithRelations,
  ProfileMatchScores,
  TResumeRowContent,
} from "../../utils/types";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { getBaseUrl } from "@/utils/get-base-url";
import { extractSectionText } from "@/utils/extract-resume-content";

interface RerankResult {
  initialProfiles: AllProfileWithRelations[];
  totalCount: number;
  /** Per-candidate rerank scores, only when the rerank succeeded. */
  matchScores?: Record<string, ProfileMatchScores>;
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
  let matchScores: Record<string, ProfileMatchScores> | undefined;

  const headersList = await headers();

  const url = await getBaseUrl();

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
    removedProfiles = initialProfiles.splice(50);

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
          const resumeContent = publicResumeContent(profile);
          const { experience, skills, projects } = extractSectionText(
            ["experience", "skills", "projects"],
            resumeContent,
          );

          return {
            user_id: profile.user_id,
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
            resume_experience: experience ?? "",
            resume_skills: skills ?? "",
            resume_projects: projects ?? "",
            min_salary: profile.min_salary,
            max_salary: profile.max_salary,
            visa_sponsorship_required: profile.visa_sponsorship_required,
          };
        }),
      }),
    });

    const aiRerankResult: {
      rerankedProfiles: string[];
      filteredOutProfiles: string[];
      scores?: Record<string, ProfileMatchScores>;
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
      matchScores = aiRerankResult.scores ?? {};
    }
  } catch (e) {
    console.error("Error during AI Rerank fetch:", e);
  }

  return { initialProfiles: finalProfiles, totalCount: finalCount, matchScores };
}

/**
 * The scrubbed resume sections of a profile (OR-REQ-010), as resume content:
 * `resume_sections` from candidate_directory, or the primary resume's stored
 * public sections. Never the raw resume, which can hold contact details.
 */
export function publicResumeContent(profile: AllProfileWithRelations): TResumeRowContent {
  const fromView = profile.resume_sections;
  if (Array.isArray(fromView)) return { sections: fromView } as TResumeRowContent;

  const stored = profile.resumes?.find((r) => r.is_primary !== false)?.resume_public_sections;
  const row = Array.isArray(stored) ? stored[0] : stored;
  return { sections: Array.isArray(row?.sections) ? row.sections : [] } as TResumeRowContent;
}
