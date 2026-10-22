import { rerankProfilesIfApplicable } from "@/helpers/profiles/ai-rerank-profiles";
import {
  getEntitlements,
  suggestedTierFor,
} from "@/helpers/billing/entitlements";
import { listPublicPlans } from "@/helpers/billing/plans";
import { buildProfileQuery } from "@/helpers/profiles/profilesFilterQueryBuilder";
import { findTalentListIdBySlug } from "@/helpers/pipeline/talent-lists";
import { outreachStatusFor } from "@/helpers/outreach/list";
import { expandProfileLocations } from "@/helpers/locations/aliases";
import { parseMultiSelectParam } from "@/utils/formatters";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getMyCompany } from "@/helpers/companies/get-my-company";
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
  // The company comes from the user's membership (recruiter teams). Internal
  // digest calls pass the owner's id and run as the service role, where
  // my_company_access() has no auth.uid(), so they look the owner up directly.
  const company = isInternalCall
    ? null
    : await getMyCompany(supabase, user).catch(() => null);
  const companyQuery = supabase
    .from("company_info")
    .select("id, ai_credits, filled, job_postings(id, embedding_new)");
  const { data: companyData, error: companyError } = isInternalCall
    ? await companyQuery.eq("user_id", user.id).single()
    : company
      ? await companyQuery.eq("id", company.id).single()
      : { data: null, error: null };
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
  const requestedLocations = parseMultiSelectParam(
    searchParams.get("location"),
  );
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
  const tab = searchParams.get("tab");
  const isFavoriteTabActive = tab === "saved";
  // A talent list's tab is its slug (PL-TASK-051). An unknown one shows
  // everyone, like the page's All tab.
  const talentListId =
    company && tab && !isFavoriteTabActive && tab !== "all"
      ? await findTalentListIdBySlug(
          { supabase, company },
          tab,
        )
      : null;
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
        talentListId,
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

    // OR-REQ-007: the company's latest outreach per candidate, for card badges.
    if (!isInternalCall && initialProfiles.length > 0) {
      const badges = await outreachStatusFor(
        { supabase, company: { id: companyData.id } },
        initialProfiles.map((p) => p.user_id),
      ).catch(() => ({}) as Awaited<ReturnType<typeof outreachStatusFor>>);
      for (const profile of initialProfiles) {
        profile.outreach_status = badges[profile.user_id]?.status ?? null;
      }
    }

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
      ...(relevanceSearchType === "digest" && matchScores
        ? { matchScores }
        : {}),
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
