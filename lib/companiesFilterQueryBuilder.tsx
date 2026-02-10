import { createClient } from "./supabase/server";
export const companiesSelectString = `id, created_at, updated_at, name, industry, description, website, headquarters, company_size, logo_url, tag_line`;

export const buildCompaniesQuery = async ({
  industry,
  location,
  name,
  size,
  start_index,
  end_index,
  isFavoriteTabActive,
  sortBy,
  sortOrder,
  userEmbedding,
}: {
  industry?: string | null;
  location?: string | null;
  name?: string | null;
  size?: string | null;
  start_index: number;
  end_index: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  isFavoriteTabActive: boolean;
  userEmbedding?: string | null;
}) => {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const parseMultiSelectParam = (
      param: string | null | undefined,
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
          error: "User not authenticated to view favorite jobs.",
          count: 0,
        };
      }
      // Explicitly select columns and exclude 'embedding'
      selectString = `
        ${companiesSelectString},
        user_favorites_companies!inner(*)
    `;
      query = supabase
        .from("company_info")
        .select(selectString, { count: "exact" })
        .eq("user_favorites_companies.user_id", user.id);
    } else {
      // Explicitly select columns and exclude 'embedding'
      selectString = `
       ${companiesSelectString},
        user_favorites_companies(*)
    `;
      query = supabase
        .from("company_info")
        .select(selectString, { count: "exact" });
    }

    let matchedCompanyIds: string[] = [];

    // --- NEW: VECTOR SEARCH LOGIC ---
    if (sortBy === "relevance" && userEmbedding) {
      // Re-build the query to include the similarity score and order by it
      const { data: searchData, error: searchError } = await supabase.rpc(
        "match_all_companies",
        {
          embedding: userEmbedding,
          match_threshold: 0.5, // You can adjust this threshold
          match_count: 100, // Fetch a larger set to then apply filters
        },
      );

      if (searchError) {
        // console.error("Vector search error:", searchError);
        throw searchError;
      }

      matchedCompanyIds = searchData.map(
        (company: { id: string }) => company.id,
      );

      // We now filter the main query to only include the matched jobs
      query = query.in("id", matchedCompanyIds);
    }
    // --- END NEW LOGIC ---

    if (isFavoriteTabActive && user) {
      query = query.filter("user_favorites_companies.user_id", "eq", user.id);
    }

    // Existing filters...

    const locationsArray = parseMultiSelectParam(location);
    if (locationsArray.length > 0) {
      query = query.in("headquarters", locationsArray);
    }

    const namesArray = parseMultiSelectParam(name);
    if (namesArray.length > 0) {
      query = query.in("name", namesArray);
    }

    const industriesArray = parseMultiSelectParam(industry);
    if (industriesArray.length > 0) {
      query = query.in("industry", industriesArray);
    }

    const sizesArray = parseMultiSelectParam(size);
    if (sizesArray.length > 0) {
      query = query.in("company_size", sizesArray);
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
      count,
      matchedCompanyIds,
    };
  } catch (e: unknown) {
    console.log(e);
    return {
      data: [],
      error:
        e instanceof Error
          ? e.message
          : "Some error occurred while fetching Jobs",
      count: 0,
    };
  }
};
