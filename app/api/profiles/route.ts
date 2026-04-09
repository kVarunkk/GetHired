import { rerankProfilesIfApplicable } from "@/helpers/profiles/ai-rerank-profiles";
import { buildProfileQuery } from "@/helpers/profiles/profilesFilterQueryBuilder";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
// let PROFILES_PER_PAGE = 20;

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const searchParams = request.nextUrl.searchParams;
  // const page = parseInt(searchParams.get("page") || "1", 10);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: companyData, error: companyError } = await supabase
    .from("company_info")
    .select("id, ai_credits, filled, job_postings(id, embedding_new)")
    .eq("user_id", user.id)
    .single();
  if (companyError || !companyData) {
    return NextResponse.json(
      { error: "Unauthorized: Not a company user" },
      { status: 403 },
    );
  }

  const searchQuery = searchParams.get("search");
  const jobRoles = searchParams.get("jobRole");
  const jobTypes = searchParams.get("jobType");
  const locations = searchParams.get("location");
  const minExperience = searchParams.get("minExperience");
  const maxExperience = searchParams.get("maxExperience");
  const minSalary = searchParams.get("minSalary");
  const maxSalary = searchParams.get("maxSalary");
  const skills = searchParams.get("skills");
  const workStyle = searchParams.get("workStylePreference");
  const companySize = searchParams.get("companySize");
  const industry = searchParams.get("industryPreference");
  // const sortBy = searchParams.get("sortBy");
  // const sortOrder = searchParams.get("sortOrder");
  const sortBy = searchParams.get("sortBy") ?? "created_at";
  const sortOrder = searchParams.get("sortOrder") ?? "desc";
  const isFavoriteTabActive = searchParams.get("tab") === "saved";
  const job_post_id = searchParams.get("job_post");
  const limit = parseInt(searchParams.get("limit") || "20");
  const cursor = searchParams.get("cursor");

  // PROFILES_PER_PAGE = parseInt(
  //   searchParams.get("limit") || PROFILES_PER_PAGE.toString(),
  // );

  // const startIndex = (page - 1) * PROFILES_PER_PAGE;
  // const endIndex = startIndex + PROFILES_PER_PAGE - 1;
  const jobEmbedding =
    companyData.job_postings?.find((job) => job.id === job_post_id)
      ?.embedding_new || null;

  try {
    const { data, error, nextCursor, count, matchedProfileIds } =
      await buildProfileQuery({
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
        cursor,
        limit,
        // start_index: startIndex,
        // end_index: endIndex,
        isFavoriteTabActive,
        jobEmbedding,
      });

    if (error) {
      return NextResponse.json({ error: error }, { status: 500 });
    }

    const { initialProfiles, totalCount } = await rerankProfilesIfApplicable({
      initialProfiles: data,
      initialCount: count,
      userId: user.id,
      jobId: job_post_id,
      aiCredits: companyData.ai_credits,
      matchedProfileIds,
      isRelevantSearch: sortBy === "relevance" && !!job_post_id,
      // relevanceSearchType,
      cursor,
      companyId: companyData.id,
    });

    return NextResponse.json({
      data: initialProfiles,
      count: totalCount,
      nextCursor,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : String(err) || "An unexpected error occurred",
      },
      { status: 500 },
    );
  }
}
