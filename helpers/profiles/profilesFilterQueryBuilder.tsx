import {
  AllProfileWithRelations,
  ProfilesBuildQueryResult,
} from "@/utils/types";
import { createClient } from "../../lib/supabase/server";
import { PostgrestError } from "@supabase/supabase-js";

const userInfoSelectString = `user_id, desired_roles, preferred_locations, min_salary, max_salary, experience_years, industry_preferences, visa_sponsorship_required, top_skills, work_style_preferences, career_goals_short_term, career_goals_long_term, company_size_preference, created_at, updated_at, job_type, ai_credits, filled, full_name, email, salary_currency, is_public`;

const parseMultiSelectParam = (param: string | null | undefined): string[] => {
  return param
    ? param
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
};

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
}): Promise<ProfilesBuildQueryResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let query;
    let selectString;

    if (isFavoriteTabActive) {
      if (!user) {
        return {
          data: [],
          error: "User not authenticated to view favorite profiles.",
          count: 0,
          matchedProfileIds: [],
          nextCursor: null,
        };
      }
      // Assuming you have fetched the companyId of the logged-in user
      const { data: companyData } = await supabase
        .from("company_info")
        .select("id")
        .eq("user_id", user.id)
        .single();

      if (!companyData) {
        return {
          data: [],
          error: "Company profile not found.",
          count: 0,
          matchedProfileIds: [],
          nextCursor: null,
        };
      }

      const companyId = companyData.id;

      selectString = `${userInfoSelectString}, company_favorites!inner(company_id)`;
      query = supabase
        .from("user_info")
        .select(
          selectString,
          // { count: "exact" }
        )
        .eq("company_favorites.company_id", companyId)
        .eq("filled", true)
        .eq("is_public", true);
    } else {
      query = supabase
        .from("user_info")
        .select(
          `
          ${userInfoSelectString}, company_favorites(*)
        `,
          // { count: "exact" },
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
    if (sortBy === "relevance" && jobEmbedding) {
      // Re-build the query to include the similarity score and order by it
      const { data: searchData, error: searchError } = await supabase.rpc(
        "match_user_profiles",
        {
          job_embedding: jobEmbedding,
          match_threshold: 0.5, // You can adjust this threshold
          match_count: 100, // Fetch a larger set to then apply filters
        },
      );

      if (searchError) {
        // console.error("Vector search error:", searchError);
        throw searchError;
      }

      matchedProfileIds = searchData.map(
        (userInfo: { user_id: string }) => userInfo.user_id,
      );

      // We now filter the main query to only include the matched jobs
      query = query.in("user_id", matchedProfileIds);
    }
    // --- END NEW LOGIC ---

    // Apply filters
    if (searchQuery) {
      query = query.ilike("full_name", `%${searchQuery}%`);
    }
    const jobRolesArray = parseMultiSelectParam(jobRoles);
    if (jobRolesArray.length > 0) {
      query = query.overlaps("desired_roles", jobRolesArray);
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
    const skillsArray = parseMultiSelectParam(skills);
    if (skillsArray.length > 0) {
      query = query.overlaps("top_skills", skillsArray);
    }
    const workStyleArray = parseMultiSelectParam(workStyle);
    if (workStyleArray.length > 0) {
      query = query.overlaps("work_style_preferences", workStyleArray);
    }
    if (companySize) {
      query = query.eq("company_size_preference", companySize);
    }
    const industryArray = parseMultiSelectParam(industry);
    if (industryArray.length > 0) {
      query = query.overlaps("industry_preferences", industryArray);
    }

    // Apply sorting
    if (sortBy && sortBy !== "relevance") {
      query = query.order(sortBy, {
        ascending: sortOrder === "asc",
        nullsFirst: false,
      });
      query = query.order("user_id", { ascending: sortOrder === "asc" }); // Tiebreaker
    }

    if (limit && sortBy !== "relevance") {
      query = query.limit(limit);
    }

    const { data, error } = (await query) as unknown as {
      data: AllProfileWithRelations[] | null;
      error: PostgrestError | null;
    };

    let totalCount = 0;
    if (!cursor) {
      const { count } = await supabase
        .from("user_info")
        .select("user_id", { count: "exact", head: true })
        .eq("filled", true)
        .eq("is_public", true);

      totalCount = count || 0;
    }

    let nextCursor = null;
    if (data && data.length === limit) {
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
