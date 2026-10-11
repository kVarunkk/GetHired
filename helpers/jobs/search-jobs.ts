import { SupabaseClient } from "@supabase/supabase-js";
import { buildQuery } from "@/helpers/jobs/filterQueryBuilder";
import { rerankJobsIfApplicable } from "@/helpers/jobs/ai-rerank-jobs";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { getCutOffDate } from "@/utils/date";
import { AllJobWithRelations, TAICredits } from "@/utils/types";
import { Database } from "@/utils/types/database.types";

export type RelevanceSearchType =
  | "standard"
  | "job_digest"
  | "job_digest_with_suggestions"
  | "similar_jobs";

export type SearchJobsParams = {
  jobType: string | null;
  location: string | null;
  visaRequirement: string | null;
  minSalary: string | null;
  minExperience: string | null;
  platform: string | null;
  companyName: string | null;
  sortBy: string;
  sortOrder: string;
  jobTitleKeywords: string | null;
  tab: "saved" | "applied" | null;
  applicationStatus: string | null;
  /** Raw "created within N days" value; converted with getCutOffDate. */
  createdAfterDays: string | null;
  /** Explicit applicant for job digests (internal calls). */
  applicantUserId: string | null;
  /** Source job for similar-jobs relevance search. */
  jobId: string | null;
  cursor: string | null;
  limit: number;
  /** "digest" selects job_digest_with_suggestions for job digests. */
  digestType: string | null;
  isInternalCall: boolean;
};

export type SearchJobsResult =
  | {
      ok: true;
      data: AllJobWithRelations[];
      totalCount: number;
      nextCursor: string | null;
    }
  | { ok: false; status: 401 | 402 | 404; error: string };

/**
 * Mutable progress record for error reporting: `stage` is the step being
 * executed and `distinctId` the user the search runs for.
 */
export type SearchJobsTrace = { stage: string; distinctId: string };

const DEFAULT_PARAMS: SearchJobsParams = {
  jobType: null,
  location: null,
  visaRequirement: null,
  minSalary: null,
  minExperience: null,
  platform: null,
  companyName: null,
  sortBy: "created_at",
  sortOrder: "desc",
  jobTitleKeywords: null,
  tab: null,
  applicationStatus: null,
  createdAfterDays: null,
  applicantUserId: null,
  jobId: null,
  cursor: null,
  limit: 20,
  digestType: null,
  isInternalCall: false,
};

export function parseJobSearchParams(
  searchParams: URLSearchParams,
  { isInternalCall }: { isInternalCall: boolean },
): SearchJobsParams {
  const tab = searchParams.get("tab");

  return {
    jobType: searchParams.get("jobType"),
    location: searchParams.get("location"),
    visaRequirement: searchParams.get("visaRequirement"),
    minSalary: searchParams.get("minSalary"),
    minExperience: searchParams.get("minExperience"),
    platform: searchParams.get("platform"),
    companyName: searchParams.get("companyName"),
    sortBy: searchParams.get("sortBy") ?? DEFAULT_PARAMS.sortBy,
    sortOrder: searchParams.get("sortOrder") ?? DEFAULT_PARAMS.sortOrder,
    jobTitleKeywords: searchParams.get("jobTitleKeywords"),
    tab: tab === "saved" || tab === "applied" ? tab : null,
    applicationStatus: searchParams.get("applicationStatus"),
    createdAfterDays: searchParams.get("createdAfter"),
    applicantUserId: searchParams.get("userId"),
    jobId: searchParams.get("jobId"),
    cursor: searchParams.get("cursor"),
    limit: parseInt(searchParams.get("limit") || String(DEFAULT_PARAMS.limit)),
    digestType: searchParams.get("type"),
    isInternalCall,
  };
}

/**
 * Job listing, filtering and relevance search shared by GET /api/jobs and the
 * agent tools. Expected failures (auth, missing profile, credits) come back as
 * `{ ok: false }`; unexpected errors are thrown with `trace` showing where.
 */
export async function searchJobs(
  supabase: SupabaseClient<Database>,
  input: Partial<SearchJobsParams>,
  trace: SearchJobsTrace = { stage: "initialize", distinctId: "unknown" },
): Promise<SearchJobsResult> {
  const params = { ...DEFAULT_PARAMS, ...input };
  const { sortBy, applicantUserId, jobId, digestType } = params;

  if (applicantUserId) trace.distinctId = applicantUserId;

  trace.stage = "resolve_relevance_profile";
  let userEmbedding = null;
  let jobEmbedding = null;
  let userId;
  let aiCredits = 0;
  let relevanceSearchType: RelevanceSearchType | null = null;

  if (sortBy === "relevance") {
    if (applicantUserId) {
      userId = applicantUserId;
      relevanceSearchType =
        digestType === "digest" ? "job_digest_with_suggestions" : "job_digest";
    } else {
      relevanceSearchType = jobId ? "similar_jobs" : "standard";

      trace.stage = "authenticate_request";
      const user = await getUserFromRequest();
      userId = user?.id;
      if (!userId) {
        return { ok: false, status: 401, error: "User not found." };
      }
      trace.distinctId = userId;

      if (jobId) {
        trace.stage = "fetch_similar_job_embedding";
        const { data: jobData, error: jobDataError } = await supabase
          .from("all_jobs")
          .select("embedding_new")
          .eq("id", jobId)
          .single();
        if (jobDataError && jobDataError.code !== "PGRST116") {
          throw jobDataError;
        }
        if (jobDataError || !jobData) {
          return {
            ok: false,
            status: 404,
            error: "Some error occured. Please try again later.",
          };
        }
        jobEmbedding = jobData.embedding_new;
      }
    }

    trace.stage = "fetch_user_embedding_and_credits";
    const { data: userData, error: userDataError } = await supabase
      .from("user_info")
      .select("embedding_new, ai_credits")
      .eq("user_id", userId)
      .single();

    if (userDataError && userDataError.code !== "PGRST116") {
      throw userDataError;
    }
    if (userDataError || !userData) {
      return { ok: false, status: 404, error: "User profile not found." };
    }
    aiCredits = userData.ai_credits;
    userEmbedding = userData.embedding_new;
  }

  if (
    relevanceSearchType === "standard" &&
    aiCredits < TAICredits.AI_SEARCH_ASK_AI_RESUME
  ) {
    return {
      ok: false,
      status: 402,
      error: "Insufficient AI credits. Please navigate to dashboard to top up.",
    };
  }

  trace.stage = "build_jobs_query";
  const { data, error, nextCursor, count, matchedJobIds } = await buildQuery({
    jobType: params.jobType,
    location: params.location,
    visaRequirement: params.visaRequirement,
    minSalary: params.minSalary,
    minExperience: params.minExperience,
    platform: params.platform,
    companyName: params.companyName,
    cursor: params.cursor,
    limit: params.limit,
    sortBy,
    sortOrder: params.sortOrder,
    jobTitleKeywords: params.jobTitleKeywords,
    isFavoriteTabActive: params.tab === "saved",
    isAppliedJobsTabActive: params.tab === "applied",
    userEmbedding,
    applicationStatus: params.applicationStatus,
    createdAfter: params.createdAfterDays
      ? getCutOffDate(Number(params.createdAfterDays))
      : null,
    isInternalCall: params.isInternalCall,
    jobEmbedding,
    relevanceSearchType,
    userId: applicantUserId,
  });

  if (error) {
    throw error;
  }

  // only used if relevanceSearchType is job_digest, similar_jobs or job_digest_with_suggestions.
  trace.stage = "rerank_jobs";
  const { initialJobs, totalCount } = await rerankJobsIfApplicable({
    initialJobs: data,
    initialCount: count,
    userId,
    jobId,
    aiCredits,
    matchedJobIds,
    relevanceSearchType,
    cursor: params.cursor,
    isInternalCall: params.isInternalCall,
  });

  return { ok: true, data: initialJobs, totalCount, nextCursor };
}
