import {
  AllProfileWithRelations,
  ProfilesBuildQueryResult,
} from "@/utils/types";
import { createClient } from "../../lib/supabase/server";
import { PostgrestError } from "@supabase/supabase-js";
import { parseMultiSelectParam } from "@/utils/formatters";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { RECRUITER_CANDIDATE_COLUMNS } from "./candidate-columns";

// RS-SEC-004: only recruiter-safe columns, never `*` or credits/referral data.
const userInfoSelectString = RECRUITER_CANDIDATE_COLUMNS;

// MT-REQ-004: what a card needs in job context (rank, score, explanation).
const JOB_MATCH_COLUMNS =
  "relevance_rank, match_score, explanation, explanation_status";

// The free-text columns the "Search" filter matches (case-insensitive substring).
const PROFILE_SEARCH_COLUMNS = [
  "full_name",
  "career_goals_short_term",
  "career_goals_long_term",
] as const;

const SEARCH_MAX_LENGTH = 100;

/**
 * Array filters that match by substring when `matchText` is on: the param, the
 * text[] column it otherwise overlaps, and the computed field (see migration
 * 20261015180000_profile_text_filters) that substring matching reads.
 */
const TEXT_MATCH_FILTERS = [
  { param: "jobRoles", column: "desired_roles", searchField: "desired_roles_search" },
  { param: "skills", column: "top_skills", searchField: "top_skills_search" },
  { param: "workStyle", column: "work_style_preferences", searchField: "work_style_preferences_search" },
  { param: "industry", column: "industry_preferences", searchField: "industry_preferences_search" },
] as const;

/**
 * Makes a search box value safe inside a PostgREST `or()` filter: drops the
 * characters that would end the quoted value or change the filter (`,()"\`)
 * and the ilike wildcards (`%`, `*`, `_`), collapses whitespace and caps it.
 */
export function sanitizeSearchTerm(raw: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/[,()"\\%*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH);
}

export async function buildProfileQuery({
  searchQuery,
  jobRoles,
  jobTypes,
  locations,
  minExperience,
  maxExperience,
  minSalary,
  maxSalary,
  skills,
  workStyle,
  companySize,
  industry,
  sortBy,
  sortOrder,
  isFavoriteTabActive = false,
  jobEmbedding,
  cursor,
  limit,
  relevanceSearchType,
  jobId,
  companyId,
  isInternalCall,
  budget = null,
  matchText = false,
  talentListId = null,
}: {
  searchQuery: string | null;
  jobRoles: string | null;
  jobTypes: string | null;
  locations: string | null;
  minExperience: string | null;
  maxExperience: string | null;
  minSalary: string | null;
  maxSalary: string | null;
  skills: string | null;
  workStyle: string | null;
  companySize: string | null;
  industry: string | null;
  sortBy: string;
  sortOrder: string;
  isFavoriteTabActive: boolean;
  jobEmbedding: string | null;
  cursor: string | null;
  limit: number | null;
  relevanceSearchType: "standard" | "digest" | null;
  jobId: string | null;
  companyId: string;
  isInternalCall: boolean;
  /** Keeps candidates whose minimum salary is at most this (the agent's "who'd take X"). */
  budget?: number | null;
  /**
   * Match roles, skills, work styles and industries by case-insensitive
   * substring (any of the terms) instead of exact values. The filter UI turns
   * this on; the agent keeps exact matching.
   */
  matchText?: boolean;
  /** Show this talent list's members (its tab) instead of everyone or the favorites. */
  talentListId?: string | null;
}): Promise<ProfilesBuildQueryResult> {
  try {
    const supabase = isInternalCall
      ? createServiceRoleClient()
      : await createClient();

    let query;
    let selectString;
    // The total of this query, with the tab and every filter applied, on the
    // first page only (later pages keep the first page's total).
    const countOption = cursor ? undefined : { count: "exact" as const };

    if (talentListId) {
      // A talent list's members (PL-TASK-051). RLS limits the join to the
      // company's own lists.
      selectString = `${userInfoSelectString}, talent_list_members!inner(list_id)`;
      query = supabase
        .from("user_info")
        .select(selectString, countOption)
        .eq("talent_list_members.list_id", talentListId)
        .eq("filled", true)
        .eq("is_public", true);
    } else if (isFavoriteTabActive) {
      selectString = `${userInfoSelectString}, company_favorites!inner(company_id)`;
      query = supabase
        .from("user_info")
        .select(selectString, countOption)
        .eq("company_favorites.company_id", companyId)
        .eq("filled", true)
        .eq("is_public", true);
    } else if (relevanceSearchType === "standard") {
      query = supabase
        .from("user_info")
        .select(
          `
          ${userInfoSelectString}, job_relevant_profiles!inner(${JOB_MATCH_COLUMNS})
        `,
          countOption,
        )
        .eq("job_relevant_profiles.job_posting_id", jobId!)
        .eq("filled", true)
        .eq("is_public", true);
    }
    // for normal search and digest
    else {
      query = supabase
        .from("user_info")
        .select(
          `
          ${userInfoSelectString} ${relevanceSearchType === "digest" ? ",resumes(content, is_primary)" : ""}
        `,
          countOption,
        )
        .eq("filled", true)
        .eq("is_public", true);
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
          `${sortBy}.not.is.null,and(${sortBy}.is.null,user_id.lt.${lastId})`,
        );
      } else {
        query = query.or(
          `${sortBy}.${operator}.${lastValue},and(${sortBy}.eq.${lastValue},user_id.${tieOperator}.${lastId})`,
        );
      }
    }

    let matchedProfileIds: string[] = [];

    // --- NEW: VECTOR SEARCH LOGIC ---
    if (relevanceSearchType === "digest" && jobEmbedding) {
      query.eq("resumes.is_primary", true);
      // Re-build the query to include the similarity score and order by it
      const { data: searchData, error: searchError } = await supabase.rpc(
        "match_user_profiles",
        {
          job_embedding: jobEmbedding,
          match_threshold: 0.3, // You can adjust this threshold
          match_count: 100, // Fetch a larger set to then apply filters
        },
      );

      if (searchError) {
        throw searchError;
      }

      matchedProfileIds = searchData.map(
        (userInfo: { user_id: string }) => userInfo.user_id,
      );

      console.log(
        matchedProfileIds.length + " profiles found through VECTOR SEARCH",
      );

      // We now filter the main query to only include the matched jobs
      query = query.in("user_id", matchedProfileIds);
    }
    // --- END NEW LOGIC ---

    // Apply filters
    const searchTerm = sanitizeSearchTerm(searchQuery);
    if (searchTerm) {
      query = query.or(
        PROFILE_SEARCH_COLUMNS.map(
          (column) => `${column}.ilike."%${searchTerm}%"`,
        ).join(","),
      );
    }
    const textFilterValues = { jobRoles, skills, workStyle, industry };
    for (const { param, column, searchField } of TEXT_MATCH_FILTERS) {
      const values = parseMultiSelectParam(textFilterValues[param]);
      if (values.length === 0) continue;
      if (!matchText) {
        query = query.overlaps(column, values);
        continue;
      }
      const terms = [
        ...new Set(values.map((v) => sanitizeSearchTerm(v).toLowerCase()).filter(Boolean)),
      ];
      if (terms.length > 0) {
        query = query.or(terms.map((term) => `${searchField}.ilike."%${term}%"`).join(","));
      }
    }
    const jobTypesArray = parseMultiSelectParam(jobTypes);
    if (jobTypesArray.length > 0) {
      query = query.overlaps("job_type", jobTypesArray);
    }
    const locationsArray = parseMultiSelectParam(locations);
    if (locationsArray.length > 0) {
      query = query.overlaps("preferred_locations", locationsArray);
    }
    if (minExperience) {
      query = query.gte("experience_years", parseInt(minExperience));
    }
    if (maxExperience) {
      query = query.lte("experience_years", parseInt(maxExperience));
    }
    if (minSalary) {
      query = query.gte("min_salary", parseInt(minSalary));
    }
    if (maxSalary) {
      query = query.lte("max_salary", parseInt(maxSalary));
    }
    if (budget !== null && budget !== undefined) {
      query = query.lte("min_salary", budget);
    }
    if (companySize) {
      query = query.eq("company_size_preference", companySize);
    }

    // Apply sorting
    if (sortBy && sortBy !== "relevance") {
      query = query.order(sortBy, {
        ascending: sortOrder === "asc",
        nullsFirst: false,
      });
      query = query.order("user_id", { ascending: sortOrder === "asc" }); // Tiebreaker
    }

    if (limit && !relevanceSearchType) {
      query = query.limit(limit);
    }

    const { data, error, count } = (await query) as unknown as {
      data: AllProfileWithRelations[] | null;
      error: PostgrestError | null;
      count: number | null;
    };

    if (relevanceSearchType === "standard" && data) {
      data.sort((a, b) => {
        const rankA = a.job_relevant_profiles?.[0]?.relevance_rank ?? 999;
        const rankB = b.job_relevant_profiles?.[0]?.relevance_rank ?? 999;
        return rankA - rankB;
      });
    }

    const totalCount = count ?? 0;

    let nextCursor = null;
    if (data && data.length === limit && !relevanceSearchType) {
      const lastItem = data[data.length - 1];
      const cursorValue = lastItem[sortBy as keyof typeof lastItem] ?? "null";

      if (lastItem.user_id) {
        nextCursor = Buffer.from(`${cursorValue}_${lastItem.user_id}`).toString(
          "base64",
        );
      }
    }

    return {
      data: data || [],
      error: error?.details,
      nextCursor,
      count: totalCount,
      matchedProfileIds,
    };
  } catch (e: unknown) {
    return {
      data: [],
      error:
        e instanceof Error
          ? e.message
          : "Some error occurred while fetching Jobs",
      count: 0,
      nextCursor: null,
      matchedProfileIds: [],
    };
  }
}
