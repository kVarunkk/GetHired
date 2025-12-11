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
}) => {
  try {
    const supabase = isInternalCall
      ? createServiceRoleClient() // No session needed, bypasses RLS
      : await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

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
      // Explicitly select columns and exclude 'embedding'
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
      // Explicitly select columns and exclude 'embedding'
      selectString = `
       ${allJobsSelectString},
        user_favorites(*),
        applications!inner(*)
    `;
      query = supabase
        .from("all_jobs")
        .select(selectString, { count: "exact" })
        .eq("applications.applicant_user_id", user.id);
    } else {
      // Explicitly select columns and exclude 'embedding'
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

    // Filter out entries with null or empty job_name
    query = query.not("job_name", "is", null);
    query = query.not("job_name", "eq", "");

    let matchedJobIds: string[] = [];

    // --- NEW: VECTOR SEARCH LOGIC ---
    if (sortBy === "relevance" && userEmbedding && createdAfter) {
      const { data: searchData, error: searchError } = await supabase.rpc(
        "match_all_jobs_new",
        {
          embedding: userEmbedding,
          match_threshold: 0.5,
          match_count: 100,
          min_created_at: createdAfter,
        }
      );

      if (searchError) {
        throw searchError;
      }

      matchedJobIds = searchData.map((job: { id: string }) => job.id);

      query = query.in("id", matchedJobIds);
    }

    // const jobTypesArray = parseMultiSelectParam(jobType);
    if (jobTypesArray.length > 0) {
      query = query.in("job_type", jobTypesArray);
    }

    // const visaRequirementsArray = parseMultiSelectParam(visaRequirement);
    if (visaRequirementsArray.length > 0) {
      query = query.in("visa_requirement", visaRequirementsArray);
    }

    // const locationsArray = parseMultiSelectParam(location);

    if (locationsArray.length > 0) {
      query = query.overlaps("normalized_locations", locationsArray);
    }

    // const platformsArray = parseMultiSelectParam(platform);
    if (platformsArray.length > 0) {
      query = query.in("platform", platformsArray);
    }

    // const companyNamesArray = parseMultiSelectParam(companyName);
    if (companyNamesArray.length > 0) {
      query = query.in("company_name", companyNamesArray);
    }

    // const jobTitleKeywordsArray = parseMultiSelectParam(jobTitleKeywords);
    if (jobTitleKeywordsArray.length > 0) {
      const orConditions = jobTitleKeywordsArray
        .map((keyword) => `job_name.ilike.%${keyword}%`)
        .join(",");
      query = query.or(orConditions);
    }

    // const applicationStatusArray = parseMultiSelectParam(applicationStatus);
    if (applicationStatusArray.length > 0) {
      query = query.in("applications.status", applicationStatusArray);
    }

    if (minSalary) {
      query = query.gte("salary_min", parseInt(minSalary as string));
    }
    if (minExperience) {
      query = query.lte("experience_min", parseInt(minExperience as string));
    }

    // Apply sorting conditionally
    if (sortBy && sortBy !== "relevance") {
      query = query.order(sortBy, { ascending: sortOrder === "asc" });
      query = query.order("id", { ascending: sortOrder === "asc" }); // Tiebreaker
    }

    // Apply pagination
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
