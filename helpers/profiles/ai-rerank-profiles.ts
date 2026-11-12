import { reportError } from "@/helpers/posthog/report-error";
import {
  AllProfileWithRelations,
  CandidateState,
  JobPostingsRow,
  ProfileMatchScores,
  TResumeRowContent,
} from "../../utils/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rerankWithJev } from "@/utils/rerank-jev";
import { extractSectionText } from "@/utils/extract-resume-content";

/** The rerank sees at most this many profiles; the rest keep their order after them. */
const RERANK_MAX_PROFILES = 50;

interface RerankResult {
  initialProfiles: AllProfileWithRelations[];
  totalCount: number;
  /** Per-candidate rerank scores, only when the rerank succeeded. */
  matchScores?: Record<string, ProfileMatchScores>;
}

export async function rerankProfilesIfApplicable({
  initialProfiles,
  initialCount,
  jobId,
  relevanceSearchType,
  cursor,
  companyId,
}: {
  initialProfiles: AllProfileWithRelations[];
  initialCount: number;
  jobId: string | null;
  cursor: string | null;
  /** The caller's company, from the session or the internal digest's lookup. Never from input. */
  companyId: string;
  relevanceSearchType: "digest" | "standard" | null;
}): Promise<RerankResult> {
  if (
    cursor ||
    !initialProfiles ||
    initialProfiles.length === 0 ||
    !relevanceSearchType ||
    relevanceSearchType === "standard" ||
    !jobId
  ) {
    return { initialProfiles, totalCount: initialCount };
  }

  const ranked = initialProfiles.slice(0, RERANK_MAX_PROFILES);
  const rest = initialProfiles.slice(RERANK_MAX_PROFILES);

  try {
    const result = await rerankProfilesForJob({ jobId, companyId, profiles: ranked });
    if (!result) return { initialProfiles, totalCount: initialCount };

    const uniqueRerankedIds = Array.from(new Set(result.rerankedIds));
    const filteredOut = new Set(result.filteredOutIds);
    const byId = new Map(ranked.map((p) => [p.user_id, p]));

    const reordered = uniqueRerankedIds
      .map((id) => byId.get(id))
      .filter((p): p is AllProfileWithRelations => !!p && !filteredOut.has(p.user_id))
      .concat(rest);

    return { initialProfiles: reordered, totalCount: reordered.length, matchScores: result.scores };
  } catch (e) {
    reportError("Error during AI Rerank:", e);
    return { initialProfiles, totalCount: initialCount };
  }
}

/**
 * Reranks profiles against one of the company's own jobs (QF-REQ-001/003).
 * Returns null when the job isn't the company's (or is gone): a stale or
 * foreign job id is a normal input, so the caller keeps the vector order.
 */
export async function rerankProfilesForJob({
  jobId,
  companyId,
  profiles,
}: {
  jobId: string;
  companyId: string;
  profiles: AllProfileWithRelations[];
}): Promise<{
  rerankedIds: string[];
  filteredOutIds: string[];
  scores: Record<string, ProfileMatchScores>;
} | null> {
  const { data: job, error } = await createServiceRoleClient()
    .from("job_postings")
    .select("id, title, description, location, job_type, salary_range, experience")
    .eq("id", jobId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!job) return null;

  const result = await rerankWithJev({
    type: "relevant_profiles",
    reference: job as JobPostingsRow,
    items: profiles.map(toCandidateState),
  });

  return {
    rerankedIds: result.reranked_job_ids ?? [],
    filteredOutIds: result.filtered_out_ids ?? [],
    scores: result.scores ?? {},
  };
}

function toCandidateState(profile: AllProfileWithRelations): CandidateState {
  const { experience, skills, projects } = extractSectionText(
    ["experience", "skills", "projects"],
    publicResumeContent(profile),
  );
  return {
    id: profile.user_id,
    preferences: {
      desired_roles: profile.desired_roles ?? undefined,
      top_skills: profile.top_skills ?? undefined,
      experience_years: profile.experience_years ?? undefined,
      preferred_locations: profile.preferred_locations ?? undefined,
      min_salary: profile.min_salary ?? undefined,
      max_salary: profile.max_salary ?? undefined,
      work_style_preferences: profile.work_style_preferences ?? undefined,
      job_type: profile.job_type ?? undefined,
      company_size_preference: profile.company_size_preference ?? undefined,
      career_goals_short_term: profile.career_goals_short_term ?? undefined,
      career_goals_long_term: profile.career_goals_long_term ?? undefined,
      visa_sponsorship_required: profile.visa_sponsorship_required ?? undefined,
    },
    experienceText: experience ?? "",
    skillsText: skills ?? "",
    projectsText: projects ?? "",
  };
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
