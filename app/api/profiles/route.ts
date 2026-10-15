import { rerankProfilesIfApplicable } from "@/helpers/profiles/ai-rerank-profiles";
import { getEntitlements, suggestedTierFor } from "@/helpers/billing/entitlements";
import { listPublicPlans } from "@/helpers/billing/plans";
import { buildProfileQuery } from "@/helpers/profiles/profilesFilterQueryBuilder";
import { expandProfileLocations } from "@/helpers/locations/aliases";
import { parseMultiSelectParam } from "@/utils/formatters";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const internalSecret = request.headers.get("X-Internal-Secret");
  const isInternalCall = internalSecret === process.env.INTERNAL_API_SECRET;

  const supabase = isInternalCall
    ? createServiceRoleClient()
    : await createClient();

  const searchParams = request.nextUrl.searchParams;

  const userId = searchParams.get("userId");

  const user =
    isInternalCall && userId
      ? (await supabase.auth.admin.getUserById(userId)).data.user
      : await getUserFromRequest();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: companyData, error: companyError } = await supabase
    .from("company_info")
    .select(
      "id, ai_credits, filled, job_postings(id, embedding_new)",
    )
    .eq("user_id", user.id)
    .single();
  if (companyError || !companyData) {
    return NextResponse.json(
      { error: "Unauthorized: Not a company user" },
      { status: 403 },
    );
  }

  // BL-REQ-023: the plan's profiles_per_search caps one search (null = no cap).
  let profilesPerSearch: number | null;
  let tierSlug: string;
  try {
    const entitlements = await getEntitlements(companyData.id);
    profilesPerSearch = entitlements.entitlements.profiles_per_search.amount;
    tierSlug = entitlements.tier.slug;
  } catch (err) {
    console.error("[profiles] couldn't load entitlements", err);
    return NextResponse.json(
      { error: "Couldn't load your plan. Please try again." },
      { status: 500 },
    );
  }
  const isLimitOnProfiles = profilesPerSearch !== null;
  const allowedProfiles = profilesPerSearch ?? 0;

  const searchQuery = searchParams.get("search");
  const jobRoles = searchParams.get("jobRole");
  const jobTypes = searchParams.get("jobType");
  // Same place, every spelling: the picker offers canonical names, profiles mix aliases.
  const requestedLocations = parseMultiSelectParam(searchParams.get("location"));
  const locations =
    requestedLocations.length > 0
      ? (await expandProfileLocations(requestedLocations)).join("|")
      : null;
  const minExperience = searchParams.get("minExperience");
  const maxExperience = searchParams.get("maxExperience");
  const minSalary = searchParams.get("minSalary");
  const maxSalary = searchParams.get("maxSalary");
  const skills = searchParams.get("skills");
  const workStyle = searchParams.get("workStylePreference");
  const companySize = searchParams.get("companySize");
  const industry = searchParams.get("industryPreference");
  const sortBy = searchParams.get("sortBy") ?? "created_at";
  const sortOrder = searchParams.get("sortOrder") ?? "desc";
  const isFavoriteTabActive = searchParams.get("tab") === "saved";
  const jobId = searchParams.get("job_post");
  const limit = isLimitOnProfiles
    ? allowedProfiles
    : parseInt(searchParams.get("limit") || "20");
  const cursor = searchParams.get("cursor");
  const jobEmbedding =
    companyData.job_postings?.find((job) => job.id === jobId)?.embedding_new ||
    null;
  // used for digest only
  // digest = we find profiles according to job id and insert them to job_relevant_profiles
  // standard = we serve the pre calculated profiles from job_relevant_profiles
  const type = searchParams.get("type");
  const relevanceSearchType: "digest" | "standard" | null =
    sortBy === "relevance" && !!jobId
      ? type === "digest" && userId
        ? "digest"
        : "standard"
      : null;

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
        isFavoriteTabActive,
        jobEmbedding,
        relevanceSearchType,
        jobId,
        isInternalCall,
        companyId: companyData.id,
        matchText: true,
      });

    if (error) {
      return NextResponse.json({ error: error }, { status: 500 });
    }

    const { initialProfiles, totalCount, matchScores } =
      await rerankProfilesIfApplicable({
      initialProfiles: data,
      initialCount: count,
      userId: user.id,
      jobId: jobId,
      aiCredits: companyData.ai_credits,
      matchedProfileIds,
      relevanceSearchType,
      cursor,
      companyId: companyData.id,
      isInternalCall,
    });

    const hiddenCount = isLimitOnProfiles
      ? Math.max(0, (totalCount ?? 0) - allowedProfiles)
      : 0;
    const upgradePlan =
      hiddenCount > 0
        ? suggestedTierFor(
            await listPublicPlans().catch(() => []),
            tierSlug,
            "profiles_per_search",
            totalCount ?? 0,
          )
        : null;

    return NextResponse.json({
      data: initialProfiles,
      count: totalCount,
      nextCursor: isLimitOnProfiles ? null : nextCursor,
      profilesPerSearch,
      // Matches beyond the cap, for "N more matching candidates on Startup".
      ...(isLimitOnProfiles ? { hiddenCount, upgradePlan } : {}),
      // MT-REQ-001: the digest stores these in job_relevant_profiles.
      ...(relevanceSearchType === "digest" && matchScores ? { matchScores } : {}),
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
