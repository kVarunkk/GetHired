import { parseMultiSelectParam } from "@/utils/formatters";
import { createClient } from "../../lib/supabase/server";
import { createServiceRoleClient } from "../../lib/supabase/service-role";
import {
  AllJobWithRelations,
  JobsBuildQueryResult,
  TApplicationStatus,
  TJobTypeEnum,
} from "@/utils/types";
import { PostgrestError } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { getCutOffDate } from "@/utils/date";
import { expandLocations } from "@/helpers/locations/aliases";
export const allJobsSelectString = `id, created_at, updated_at, job_name, job_type, platform, locations, salary_range, visa_requirement, salary_min, salary_max, company_name, experience, experience_min, experience_max, equity_range, equity_min, equity_max, status, ai_summary, is_platform_job`;

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
  relevanceSearchType:
    | "standard"
    | "job_digest"
    | "job_digest_with_suggestions"
    | "similar_jobs"
    | null;
  userId: string | null;
}): Promise<JobsBuildQueryResult> => {
  try {
    const supabase = isInternalCall
      ? createServiceRoleClient()
      : await createClient();

    const user =
      isInternalCall && userId
        ? (await supabase.auth.admin.getUserById(userId)).data.user
        : await getUserFromRequest();

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
    // The total of this query, with the tab and every filter applied, on the
    // first page only (later pages keep the first page's total).
    const countOption = cursor ? undefined : { count: "exact" as const };

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
        user_favorites!inner(*)
        
    `;
      query = supabase
        .from("all_jobs")
        .select(selectString, countOption)
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
        applications!inner(*)
    `;
      query = supabase
        .from("all_jobs")
        .select(selectString, countOption)
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
        user_relevant_jobs!inner(*)
     
    `;
      query = supabase
        .from("all_jobs")
        .select(selectString, countOption)
        .eq("user_relevant_jobs.user_id", user.id);
    } else {
      selectString = `
       ${allJobsSelectString}
       
    `;
      query = supabase
        .from("all_jobs")
        .select(selectString, countOption)
        .eq("status", "active");
    }

    if (cursor && sortBy !== "relevance") {
      const decoded = Buffer.from(cursor, "base64").toString("utf8");

      const parts = decoded.split("_");
      const lastId = parts.pop();
      const lastValue = parts.join("_");
      // Rows come in (sortBy, id) order, both in the same direction, with
      // nulls last either way (see the order below).
      const operator = sortOrder === "desc" ? "lt" : "gt";
      if (lastValue === "null") {
        // Already into the nulls: only the nulls after this id are left.
        query = query.is(sortBy, null).filter("id", operator, lastId);
      } else {
        // Quoted so commas and parentheses (e.g. in company names) stay
        // inside the value.
        const value = `"${lastValue.replace(/["\\]/g, "\\$&")}"`;
        query = query.or(
          `${sortBy}.${operator}.${value},and(${sortBy}.eq.${value},id.${operator}.${lastId}),${sortBy}.is.null`,
        );
      }
    }

    query = query.not("job_name", "is", null);
    query = query.not("job_name", "eq", "");

    let matchedJobIds: string[] = [];

    // --- VECTOR SEARCH ---
    if (
      ((relevanceSearchType === "job_digest" ||
        relevanceSearchType === "job_digest_with_suggestions") &&
        userEmbedding) ||
      (relevanceSearchType === "similar_jobs" && jobEmbedding)
    ) {
      const { data: searchData, error: searchError } = await supabase.rpc(
        "match_all_jobs_test",
        {
          embedding:
            relevanceSearchType === "similar_jobs"
              ? jobEmbedding!
              : userEmbedding!,
          // the cosine distance between the job and user embedding must be less than 0.35
          match_threshold: 0.35,
          match_count:
            relevanceSearchType === "job_digest_with_suggestions" ? 50 : 100,
          min_created_at: createdAfter ?? getCutOffDate(60),
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
      // Every spelling of each place (e.g. bangalore + bengaluru), lowercased,
      // since jobs aren't always stored under the canonical name.
      const searchLocations = await expandLocations(locationsArray);
      query = query.overlaps("normalized_locations", searchLocations);
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
      query = query.gte("salary_min", parseInt(minSalary));
    }
    if (minExperience) {
      query = query.gte("experience_min", parseInt(minExperience));
    }

    if (sortBy && sortBy !== "relevance") {
      query = query.order(sortBy, {
        ascending: sortOrder === "asc",
        nullsFirst: false,
      });
      query = query.order("id", { ascending: sortOrder === "asc" }); // Tiebreaker
    }

    if (limit && !relevanceSearchType) {
      query = query.limit(limit);
    }

    const { data, error, count } = (await query) as unknown as {
      data: AllJobWithRelations[] | null;
      error: PostgrestError | null;
      count: number | null;
    };

    if (relevanceSearchType === "standard" && data) {
      data.sort((a, b) => {
        const rankA = a.user_relevant_jobs?.[0]?.relevance_rank ?? 999;
        const rankB = b.user_relevant_jobs?.[0]?.relevance_rank ?? 999;
        return rankA - rankB;
      });
    }

    const totalCount = count ?? 0;

    let nextCursor = null;
    if (data && data.length === limit && !relevanceSearchType) {
      const lastItem = data[data.length - 1];
      const cursorValue = lastItem[sortBy as keyof typeof lastItem] ?? "null";

      if (lastItem.id) {
        nextCursor = Buffer.from(`${cursorValue}_${lastItem.id}`).toString(
          "base64",
        );
      }
    }

    if (data && data.length > 0 && user?.id) {
      const serviceRoleSupabase = createServiceRoleClient();
      const jobIds = data.map((job) => job.id);
      const { data: urlData } = await serviceRoleSupabase.rpc(
        "get_masked_job_urls",
        {
          p_job_ids: jobIds,
          p_user_id: user.id,
        },
      );

      const urlMap = new Map(
        (urlData ?? []).map((u) => [
          u.id,
          { job_url: u.job_url, company_url: u.company_url },
        ]),
      );

      data.forEach((job) => {
        const urls = urlMap.get(job.id);
        job.job_url = urls?.job_url ?? null;
        job.company_url = urls?.company_url ?? null;
      });
    }

    return {
      data: data || [],
      error,
      nextCursor,
      count: totalCount,
      matchedJobIds,
    };
  } catch (e: unknown) {
    return {
      data: [],
      error: e,
      nextCursor: null,
      count: 0,
      matchedJobIds: [],
    };
  }
};
