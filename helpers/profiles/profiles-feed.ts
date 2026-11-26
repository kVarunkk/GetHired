import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { reportError } from "@/helpers/posthog/report-error";
import { parseCurrencyCode } from "@/helpers/currency/currencies";
import { rerankProfilesIfApplicable } from "@/helpers/profiles/ai-rerank-profiles";
import { getEntitlements, suggestedTierFor } from "@/helpers/billing/entitlements";
import type { SuggestedTier } from "@/helpers/billing/errors";
import { listPublicPlans } from "@/helpers/billing/plans";
import { buildProfileQuery } from "@/helpers/profiles/profilesFilterQueryBuilder";
import { findTalentListIdBySlug } from "@/helpers/pipeline/talent-lists";
import { outreachStatusFor } from "@/helpers/outreach/list";
import { expandProfileLocations } from "@/helpers/locations/aliases";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { parseMultiSelectParam } from "@/utils/formatters";
import type { AllProfileWithRelations } from "@/utils/types";
import type { Database } from "@/utils/types/database.types";

export type ProfilesFeedBody = {
  data?: AllProfileWithRelations[];
  count?: number | null;
  nextCursor?: string | null;
  error?: unknown;
  profilesPerSearch?: number | null;
  hiddenCount?: number;
  upgradePlan?: SuggestedTier | null;
  matchScores?: unknown;
};

/**
 * One page of talent search, for /api/profiles and the Discover page (which
 * calls this instead of its own API). The caller has already authenticated
 * `user`. `isInternalCall` is only ever true when the route has checked the
 * internal secret, and then `supabase` is the service role.
 */
export async function loadProfilesFeed({
  supabase,
  user,
  searchParams,
  isInternalCall = false,
}: {
  supabase: SupabaseClient<Database>;
  user: User;
  searchParams: URLSearchParams;
  isInternalCall?: boolean;
}): Promise<{ status: number; body: ProfilesFeedBody }> {
  const userId = searchParams.get("userId");

  // The company comes from the user's membership (recruiter teams). Internal
  // digest calls pass the owner's id and run as the service role, where
  // my_company_access() has no auth.uid(), so they look the owner up directly.
  const company = isInternalCall
    ? null
    : await getMyCompany(supabase, user).catch(() => null);
  let companyId = company?.id;
  if (isInternalCall) {
    const { data, error } = await supabase
      .from("company_info")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (!error) companyId = data?.id;
  }
  if (!companyId) {
    return { status: 403, body: { error: "Unauthorized: Not a company user" } };
  }

  const tab = searchParams.get("tab");
  const isFavoriteTabActive = tab === "saved";
  // Same place, every spelling: the picker offers canonical names, profiles mix aliases.
  const requestedLocations = parseMultiSelectParam(
    searchParams.get("location"),
  );

  // None of these depend on each other, and each is a round trip.
  const [entitlements, expandedLocations, talentListId] = await Promise.all([
    getEntitlements(companyId).catch((err) => {
      reportError("[profiles] couldn't load entitlements", err);
      return null;
    }),
    requestedLocations.length > 0
      ? expandProfileLocations(requestedLocations)
      : null,
    // A talent list's tab is its slug (PL-TASK-051). An unknown one shows
    // everyone, like the page's All tab.
    company && tab && !isFavoriteTabActive && tab !== "all"
      ? findTalentListIdBySlug({ supabase, company }, tab)
      : null,
  ]);
  if (!entitlements) {
    return { status: 500, body: { error: "Couldn't load your plan. Please try again." } };
  }
  // BL-REQ-023: the plan's profiles_per_search caps one search (null = no cap).
  const profilesPerSearch = entitlements.entitlements.profiles_per_search.amount;
  const tierSlug = entitlements.tier.slug;
  const isLimitOnProfiles = profilesPerSearch !== null;
  const allowedProfiles = profilesPerSearch ?? 0;

  const searchQuery = searchParams.get("search");
  const jobRoles = searchParams.get("jobRole");
  const jobTypes = searchParams.get("jobType");
  const locations = expandedLocations?.join("|") ?? null;
  const minExperience = searchParams.get("minExperience");
  const maxExperience = searchParams.get("maxExperience");
  const minSalary = searchParams.get("minSalary");
  const maxSalary = searchParams.get("maxSalary");
  const salaryCurrency = parseCurrencyCode(searchParams.get("salaryCurrency"));
  const skills = searchParams.get("skills");
  const workStyle = searchParams.get("workStylePreference");
  const companySize = searchParams.get("companySize");
  const industry = searchParams.get("industryPreference");
  const sortBy = searchParams.get("sortBy") ?? "created_at";
  const sortOrder = searchParams.get("sortOrder") ?? "desc";
  const jobId = searchParams.get("job_post");
  const limit = isLimitOnProfiles
    ? allowedProfiles
    : parseInt(searchParams.get("limit") || "20");
  const cursor = searchParams.get("cursor");
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
    // Only the digest searches by the job's vector. Embeddings are large, so no
    // other search loads one.
    let jobEmbedding: string | null = null;
    if (relevanceSearchType === "digest") {
      const { data: job, error: jobError } = await supabase
        .from("job_postings")
        .select("embedding_new")
        .eq("id", jobId!)
        .eq("company_id", companyId)
        .maybeSingle();
      if (jobError) throw jobError;
      jobEmbedding = job?.embedding_new || null;
    }

    const { data, error, nextCursor, count } =
      await buildProfileQuery({
        searchQuery,
        jobRoles,
        jobTypes,
        locations,
        minExperience,
        maxExperience,
        minSalary,
        maxSalary,
        salaryCurrency,
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
        companyId,
        matchText: true,
      });

    if (error) {
      return { status: 500, body: { error } };
    }

    const { initialProfiles, totalCount, matchScores } =
      await rerankProfilesIfApplicable({
        initialProfiles: data,
        initialCount: count,
        jobId: jobId,
        relevanceSearchType,
        cursor,
        companyId,
      });

    const hiddenCount = isLimitOnProfiles
      ? Math.max(0, (totalCount ?? 0) - allowedProfiles)
      : 0;
    const [badges, upgradePlan] = await Promise.all([
      // OR-REQ-007: the company's latest outreach per candidate, for card badges.
      !isInternalCall && initialProfiles.length > 0
        ? outreachStatusFor(
            { supabase, company: { id: companyId } },
            initialProfiles.map((p) => p.user_id),
          ).catch(() => ({}) as Awaited<ReturnType<typeof outreachStatusFor>>)
        : null,
      hiddenCount > 0
        ? listPublicPlans()
            .catch(() => [])
            .then((plans) =>
              suggestedTierFor(plans, tierSlug, "profiles_per_search", totalCount ?? 0),
            )
        : null,
    ]);
    if (badges) {
      for (const profile of initialProfiles) {
        profile.outreach_status = badges[profile.user_id]?.status ?? null;
      }
    }

    return {
      status: 200,
      body: {
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
      },
    };
  } catch (err: unknown) {
    reportError("[profiles] failed", err);
    return {
      status: 500,
      body: {
        error:
          err instanceof Error
            ? err.message
            : String(err) || "An unexpected error occurred",
      },
    };
  }
}
