import { createClient } from "./supabase/server";

const userInfoSelectString = `user_id, desired_roles, preferred_locations, min_salary, max_salary, experience_years, industry_preferences, visa_sponsorship_required, top_skills, work_style_preferences, career_goals_short_term, career_goals_long_term, company_size_preference, resume_url, created_at, updated_at, resume_name, job_type, resume_path, ai_credits, filled, full_name, email, salary_currency`;

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
  // visaRequired,
  sortKey,
  sortOrder,
  start_index,
  end_index,
  isFavoriteTabActive = false,
  jobEmbedding,
}: {
  searchQuery?: string | null;
  jobRoles?: string | null;
  jobTypes?: string | null;
  locations?: string | null;
  minExperience?: string | null;
  maxExperience?: string | null;
  minSalary?: string | null;
  maxSalary?: string | null;
  skills?: string | null;
  workStyle?: string | null;
  companySize?: string | null;
  industry?: string | null;
  // visaRequired?: boolean;
  sortKey?: string;
  sortOrder?: "asc" | "desc";
  start_index: number;
  end_index: number;
  isFavoriteTabActive?: boolean;
  jobEmbedding?: string | null;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const parseMultiSelectParam = (
      param: string | null | undefined
    ): string[] => {
      return param
        ? param
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    };

    let query;
    let selectString;

    if (isFavoriteTabActive) {
      if (!user) {
        return {
          data: [],
          error: "User not authenticated to view favorite profiles.",
          count: 0,
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
        };
      }

      const companyId = companyData.id;

      selectString = `${userInfoSelectString}, company_favorites!inner(company_id)`;
      query = supabase
        .from("user_info")
        .select(selectString, { count: "exact" })
        .eq("company_favorites.company_id", companyId)
        .eq("filled", true);
    } else {
      query = supabase
        .from("user_info")
        .select(
          `
          ${userInfoSelectString}, company_favorites(*)
        `,
          { count: "exact" }
        )
        .eq("filled", true);
    }

    let matchedProfileIds: string[] = [];

    // --- NEW: VECTOR SEARCH LOGIC ---
    if (sortKey === "relevance" && jobEmbedding) {
      // Re-build the query to include the similarity score and order by it
      const { data: searchData, error: searchError } = await supabase.rpc(
        "match_user_profiles",
        {
          job_embedding: jobEmbedding,
          match_threshold: 0.5, // You can adjust this threshold
          match_count: 100, // Fetch a larger set to then apply filters
        }
      );

      if (searchError) {
        // console.error("Vector search error:", searchError);
        throw searchError;
      }

      matchedProfileIds = searchData.map(
        (userInfo: { user_id: string }) => userInfo.user_id
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
      // console.log("Filtering locations:", locations);
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
    if (sortKey && sortKey !== "relevance") {
      query = query.order(sortKey, { ascending: sortOrder === "asc" });
      query = query.order("user_id", { ascending: sortOrder === "asc" }); // Tiebreaker
    }

    // Apply pagination
    query = query.range(start_index, end_index);

    const { data, error, count } = await query;

    return {
      data,
      error: error?.details,
      count,
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
    };
  }
}
