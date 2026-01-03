import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCompaniesQuery } from "@/lib/companiesFilterQueryBuilder";

let COMPANIES_PER_PAGE = 20;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1", 10);
  const industry = searchParams.get("industry");
  const location = searchParams.get("location");
  const name = searchParams.get("name");
  const sortBy = searchParams.get("sortBy");
  const sortOrder = searchParams.get("sortOrder");
  const size = searchParams.get("size");
  const isFavoriteTabActive = searchParams.get("tab") === "saved";
  COMPANIES_PER_PAGE = parseInt(
    searchParams.get("limit") || COMPANIES_PER_PAGE.toString()
  );

  const startIndex = (page - 1) * COMPANIES_PER_PAGE;
  const endIndex = startIndex + COMPANIES_PER_PAGE - 1;

  try {
    let userEmbedding = null;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (sortBy === "relevance" && user) {
      const { data: userData, error } = await supabase
        .from("user_info")
        .select("embedding_new")
        .eq("user_id", user.id)
        .single();

      if (error || !userData) {
      } else {
        userEmbedding = userData.embedding_new;
      }
    }

    const { data, error, count, matchedCompanyIds } = await buildCompaniesQuery(
      {
        industry,
        location,
        name,
        size,
        start_index: startIndex,
        end_index: endIndex,
        sortBy: sortBy ?? undefined,
        sortOrder: sortOrder as "asc" | "desc",
        isFavoriteTabActive: isFavoriteTabActive,
        userEmbedding,
      }
    );

    if (error) {
      // console.error("API Error fetching jobs:", error);
      return NextResponse.json({ error: error }, { status: 500 });
    }

    return NextResponse.json({ data: data || [], count, matchedCompanyIds });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : String(err) || "An unexpected error occurred",
      },
      { status: 500 }
    );
  }
}
