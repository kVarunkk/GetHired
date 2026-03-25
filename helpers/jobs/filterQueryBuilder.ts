import { createClient } from "../../lib/supabase/server";
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import {
  AllJobWithRelations,
  JobsBuildQueryResult,
  TApplicationStatus,
  TJobTypeEnum,
} from "@/utils/types";
import { PostgrestError } from "@supabase/supabase-js";
export const allJobsSelectString = `id, created_at, updated_at, job_name, job_type, platform, locations, salary_range, visa_requirement, salary_min, salary_max, company_name, company_url, experience, experience_min, experience_max, equity_range, equity_min, equity_max, job_url, status, ai_summary`;
const jobPostingsSelectString = `id, created_at, updated_at, company_id, title, job_type, salary_range, status, location, min_salary, max_salary, min_experience, max_experience, visa_sponsorship, min_equity, max_equity, experience, equity_range, salary_currency, questions, job_id`;
const companyInfoSelectString = `id, name, website, logo_url, description, industry, company_size, headquarters`;

const parseMultiSelectParam = <T extends string>(
  param: string | null | undefined,
): T[] => {
  return param
    ? (param
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean) as T[])
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
  cursor,
  limit,
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
  jobType: string | null;
  visaRequirement: string | null;
  location: string | null;
  minSalary: string | null;
  minExperience: string | null;
  platform: string | null;
  companyName: string | null;
  cursor: string | null;
  limit: number | null;
  sortBy: string;
  sortOrder: string;
  jobTitleKeywords: string | null;
  isFavoriteTabActive: boolean;
  isAppliedJobsTabActive: boolean;
  userEmbedding: string | null;
  applicationStatus: string | null;
  createdAfter: string | null;
  isInternalCall: boolean;
  jobEmbedding: string | null;
  relevanceSearchType: "standard" | "job_digest" | "similar_jobs" | null;
  userId: string | null;
}): Promise<JobsBuildQueryResult> => {
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

    const jobTypesArray = parseMultiSelectParam<TJobTypeEnum>(jobType);
    const visaRequirementsArray = parseMultiSelectParam(visaRequirement);
    const locationsArray = parseMultiSelectParam(location);
    const platformsArray = parseMultiSelectParam(platform);
    const companyNamesArray = parseMultiSelectParam(companyName);
    const jobTitleKeywordsArray = parseMultiSelectParam(jobTitleKeywords);
    const applicationStatusArray = parseMultiSelectParam(
      applicationStatus,
    ).filter((s): s is TApplicationStatus =>
      Object.values(TApplicationStatus).includes(s as TApplicationStatus),
    );

    let query;
    let selectString;

    if (isFavoriteTabActive) {
      if (!user) {
        return {
          data: [],
          error: "User not authenticated to view favorite jobs.",
          count: 0,
          nextCursor: null,
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
        .select(selectString)
        .eq("user_favorites.user_id", user.id);
    } else if (isAppliedJobsTabActive) {
      if (!user) {
        return {
          data: [],
          error: "User not authenticated to view applied jobs.",
          count: 0,
          nextCursor: null,
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
        .select(selectString)
        .eq("applications.applicant_user_id", user.id);
    } else if (relevanceSearchType === "standard") {
      if (!user) {
        return {
          data: [],
          error: "User not authenticated to view relevant jobs.",
          count: 0,
          nextCursor: null,
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
        .select(selectString)
        .eq("user_relevant_jobs.user_id", user.id);
    } else {
      selectString = `
       ${allJobsSelectString},
        user_favorites(*),
        job_postings(${jobPostingsSelectString}, company_info(${companyInfoSelectString}))
    `;
      query = supabase
        .from("all_jobs")
        .select(selectString)
        .eq("status", "active");
    }

    if (cursor && sortBy !== "relevance") {
      const decoded = Buffer.from(cursor, "base64").toString("ascii");

      const parts = decoded.split("_");
      const lastId = parts.pop();
      const lastValue = parts.join("_");
      const operator = sortOrder === "desc" ? "lt" : "gt";
      const tieOperator = "lt";
      if (lastValue === "null" || lastValue === null) {
        // Last item had null salary - everything with null salary after this id
        // and all non-null salaries (they come before nulls)
        query = query.or(
          `${sortBy}.not.is.null,and(${sortBy}.is.null,id.lt.${lastId})`,
        );
      } else {
        query = query.or(
          `${sortBy}.${operator}.${lastValue},and(${sortBy}.eq.${lastValue},id.${tieOperator}.${lastId})`,
        );
      }
    }

    query = query.not("job_name", "is", null);
    query = query.not("job_name", "eq", "");

    let matchedJobIds: string[] = [];

    // --- VECTOR SEARCH ---
    if (
      createdAfter &&
      ((relevanceSearchType === "job_digest" && userEmbedding) ||
        (relevanceSearchType === "similar_jobs" && jobEmbedding))
    ) {
      const { data: searchData, error: searchError } = await supabase.rpc(
        "match_all_jobs_test",
        {
          embedding:
            relevanceSearchType === "similar_jobs"
              ? jobEmbedding!
              : userEmbedding!,
          match_threshold: 0.4,
          match_count: relevanceSearchType === "similar_jobs" ? 10 : 100,
          min_created_at: createdAfter,
        },
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
      const lowercasedLocations = locationsArray.map((loc) =>
        loc.toLowerCase().trim(),
      );
      query = query.overlaps("normalized_locations", lowercasedLocations);
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
      query = query.order(sortBy, {
        ascending: sortOrder === "asc",
        nullsFirst: false,
      });
      query = query.order("id", { ascending: sortOrder === "asc" }); // Tiebreaker
    }

    if (limit && relevanceSearchType !== "standard") {
      query = query.limit(limit);
    }

    const { data, error } = (await query) as unknown as {
      data: AllJobWithRelations[] | null;
      error: PostgrestError | null;
    };

    if (relevanceSearchType === "standard" && data) {
      data.sort((a, b) => {
        const rankA = a.user_relevant_jobs?.[0]?.relevance_rank ?? 999;
        const rankB = b.user_relevant_jobs?.[0]?.relevance_rank ?? 999;
        return rankA - rankB;
      });
    }

    let totalCount = 0;
    if (!cursor) {
      const { count } = await supabase
        .from("all_jobs")
        .select("id", { count: "exact", head: true });

      totalCount = count || 0;
    }

    let nextCursor = null;
    if (data && data.length === limit) {
      const lastItem = data[data.length - 1];
      const cursorValue = lastItem[sortBy as keyof typeof lastItem] ?? "null";

      if (lastItem.id) {
        nextCursor = Buffer.from(`${cursorValue}_${lastItem.id}`).toString(
          "base64",
        );
      }
    }

    return {
      data: data || [],
      error: error?.details,
      nextCursor,
      count: totalCount,
      matchedJobIds,
    };
  } catch (e: unknown) {
    return {
      data: [],
      error:
        e instanceof Error
          ? e.message
          : "Some error occurred while fetching Jobs",
      nextCursor: null,
      count: 0,
      matchedJobIds: [],
    };
  }
};
