import { createClient } from "./supabase/server";
import { createServiceRoleClient } from "./supabase/service-role";
export const allJobsSelectString = `id, created_at, updated_at, job_name, job_type, platform, locations, salary_range, visa_requirement, salary_min, salary_max, company_name, company_url, experience, experience_min, experience_max, equity_range, equity_min, equity_max, job_url, status, ai_summary`;
const jobPostingsSelectString = `id, created_at, updated_at, company_id, title, job_type, salary_range, status, location, min_salary, max_salary, min_experience, max_experience, visa_sponsorship, min_equity, max_equity, experience, equity_range, salary_currency, questions, job_id`;
const companyInfoSelectString = `id, name, website, logo_url, description, industry, company_size, headquarters`;

const parseMultiSelectParam = (param: string | null | undefined): string[] => {
  return param
    ? param
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
};

export const buildQuery = async ({
  jobType,
  visaRequirement,
  location,
  minSalary,
  minExperience,
  platform,
  companyName,
  start_index,
  end_index,
  jobTitleKeywords,
  isFavoriteTabActive,
  isAppliedJobsTabActive,
  sortBy,
  sortOrder,
  userEmbedding,
  applicationStatus,
  createdAfter,
  isInternalCall,
  jobEmbedding,
  relevanceSearchType,
  userId,
}: {
  jobType?: string | null;
  visaRequirement?: string | null;
  location?: string | null;
  minSalary?: string | null;
  minExperience?: string | null;
  platform?: string | null;
  companyName?: string | null;
  start_index: number;
  end_index: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  jobTitleKeywords?: string | null;
  isFavoriteTabActive: boolean;
  isAppliedJobsTabActive?: boolean;
  userEmbedding?: string | null;
  applicationStatus?: string | null;
  createdAfter?: string | null;
  isInternalCall?: boolean;
  jobEmbedding?: string | null;
  relevanceSearchType: "standard" | "job_digest" | "similar_jobs" | null;
  userId: string | null;
}) => {
  try {
    const supabase = isInternalCall
      ? createServiceRoleClient()
      : await createClient();

    const {
      data: { user },
    } =
      isInternalCall && userId
        ? await supabase.auth.admin.getUserById(userId)
        : await supabase.auth.getUser();

    const jobTypesArray = parseMultiSelectParam(jobType);
    const visaRequirementsArray = parseMultiSelectParam(visaRequirement);
    const locationsArray = parseMultiSelectParam(location);
    const platformsArray = parseMultiSelectParam(platform);
    const companyNamesArray = parseMultiSelectParam(companyName);
    const jobTitleKeywordsArray = parseMultiSelectParam(jobTitleKeywords);
    const applicationStatusArray = parseMultiSelectParam(applicationStatus);

    let query;
    let selectString;

    if (isFavoriteTabActive) {
      if (!user) {
        return {
          data: [],
          error: "User not authenticated to view favorite jobs.",
          count: 0,
          matchedJobIds: [],
        };
      }
      selectString = `
        ${allJobsSelectString},
        user_favorites!inner(*),
        job_postings(${jobPostingsSelectString}, company_info(${companyInfoSelectString}), applications(*)),
        applications(*)
    `;
      query = supabase
        .from("all_jobs")
        .select(selectString, { count: "exact" })
        .eq("user_favorites.user_id", user.id);
    } else if (isAppliedJobsTabActive) {
      if (!user) {
        return {
          data: [],
          error: "User not authenticated to view applied jobs.",
          count: 0,
          matchedJobIds: [],
        };
      }
      selectString = `
       ${allJobsSelectString},
        user_favorites(*),
        applications!inner(*)
    `;
      query = supabase
        .from("all_jobs")
        .select(selectString, { count: "exact" })
        .eq("applications.applicant_user_id", user.id);
    } else if (relevanceSearchType === "standard") {
      if (!user) {
        return {
          data: [],
          error: "User not authenticated to view relevant jobs.",
          count: 0,
          matchedJobIds: [],
        };
      }
      selectString = `
        ${allJobsSelectString},
        user_relevant_jobs!inner(*),
        user_favorites(*),
        job_postings(${jobPostingsSelectString}, company_info(${companyInfoSelectString}), applications(*)),
        applications(*)
    `;
      query = supabase
        .from("all_jobs")
        .select(selectString, { count: "exact" })
        .eq("user_relevant_jobs.user_id", user.id);
      // .neq("user_relevant_jobs.jobs_id", null);
    } else {
      selectString = `
       ${allJobsSelectString},
        user_favorites(*),
        job_postings(${jobPostingsSelectString}, company_info(${companyInfoSelectString}))
    `;
      query = supabase
        .from("all_jobs")
        .select(selectString, { count: "exact" })
        .eq("status", "active");
    }

    query = query.not("job_name", "is", null);
    query = query.not("job_name", "eq", "");

    let matchedJobIds: string[] = [];

    // --- VECTOR SEARCH FOR AI SMART SEARCH ---
    if (
      sortBy === "relevance" &&
      createdAfter &&
      relevanceSearchType &&
      relevanceSearchType !== "standard" &&
      (userEmbedding || jobEmbedding)
    ) {
      const { data: searchData, error: searchError } = await supabase.rpc(
        "match_all_jobs_test",
        {
          embedding:
            relevanceSearchType === "similar_jobs"
              ? jobEmbedding
              : userEmbedding,
          match_threshold: 0.4,
          match_count: relevanceSearchType === "similar_jobs" ? 10 : 100,
          min_created_at: createdAfter,
        }
      );

      if (searchError) {
        throw searchError;
      }

      console.log(searchData.length + " jobs found from vector search");
      matchedJobIds = searchData.map((job: { id: string }) => job.id);

      query = query.in("id", matchedJobIds);
    }

    if (sortBy !== "relevance" && createdAfter) {
      query = query.gte("created_at", createdAfter);
    }

    if (relevanceSearchType === "standard" && createdAfter) {
      query = query.gte("created_at", createdAfter);
    }

    if (jobTypesArray.length > 0) {
      query = query.in("job_type", jobTypesArray);
    }

    if (visaRequirementsArray.length > 0) {
      query = query.in("visa_requirement", visaRequirementsArray);
    }

    if (locationsArray.length > 0) {
      query = query.overlaps("normalized_locations", locationsArray);
    }

    if (platformsArray.length > 0) {
      query = query.in("platform", platformsArray);
    }

    if (companyNamesArray.length > 0) {
      query = query.in("company_name", companyNamesArray);
    }

    if (jobTitleKeywordsArray.length > 0) {
      const orConditions = jobTitleKeywordsArray
        .map((keyword) => `job_name.ilike.%${keyword}%`)
        .join(",");
      query = query.or(orConditions);
    }

    if (applicationStatusArray.length > 0) {
      query = query.in("applications.status", applicationStatusArray);
    }

    if (minSalary) {
      query = query.gte("salary_min", parseInt(minSalary as string));
    }
    if (minExperience) {
      query = query.lte("experience_min", parseInt(minExperience as string));
    }

    if (sortBy && sortBy !== "relevance") {
      query = query.order(sortBy, { ascending: sortOrder === "asc" });
      query = query.order("id", { ascending: sortOrder === "asc" }); // Tiebreaker
    }

    if (relevanceSearchType === "standard") {
      query = query.order("relevance_rank", {
        referencedTable: "user_relevant_jobs",
        ascending: sortOrder === "asc",
      });
      query = query.order("id", { ascending: sortOrder === "asc" });
    }

    query = query.range(start_index, end_index);

    const { data, error, count } = await query;

    return {
      data,
      error: error?.details,
      count: count || 0,
      matchedJobIds,
    };
  } catch (e: unknown) {
    return {
      data: [],
      error:
        e instanceof Error
          ? e.message
          : "Some error occurred while fetching Jobs",
      count: 0,
      matchedJobIds: [],
    };
  }
};
