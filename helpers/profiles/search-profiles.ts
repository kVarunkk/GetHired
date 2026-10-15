import "server-only";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { expandProfileLocations } from "@/helpers/locations/aliases";
import type { AllProfileWithRelations } from "@/utils/types";
import { buildProfileQuery } from "./profilesFilterQueryBuilder";

export type ProfileSearchParams = {
  roles?: string[];
  skills?: string[];
  locations?: string[];
  minExperience?: number;
  maxExperience?: number;
  /** Candidates whose minimum salary is at most this. */
  budget?: number;
  jobTypes?: string[];
  workStyle?: string[];
  limit: number;
  cursor?: string | null;
};

const joined = (values: string[] | undefined) =>
  values && values.length > 0 ? values.join("|") : null;

const asParam = (value: number | undefined) => (value === undefined ? null : String(value));

/**
 * A talent-pool search for one company, newest profiles first, capped at the
 * plan's `profiles_per_search` (BL-REQ-023). Uses `buildProfileQuery`, the
 * same query as /api/profiles, with the session's client, so RLS and
 * `is_public` decide who's visible (RA-CON-003). Locations match every
 * spelling of the place, since profiles mix e.g. "bangalore" and
 * "Bengaluru". Roles, skills and work styles match by case-insensitive
 * substring, like the filter UI. Errors are thrown.
 */
export async function searchProfiles(
  companyId: string,
  params: ProfileSearchParams,
): Promise<{
  profiles: AllProfileWithRelations[];
  nextCursor: string | null;
  /** The plan's cap on one search, or null when there's none. */
  planLimit: number | null;
}> {
  const { entitlements } = await getEntitlements(companyId);
  const planLimit = entitlements.profiles_per_search?.amount ?? null;
  const capped = planLimit !== null;
  // buildProfileQuery treats a limit of 0 as "no limit".
  if (capped && planLimit <= 0) return { profiles: [], nextCursor: null, planLimit };

  const locations = params.locations?.length
    ? await expandProfileLocations(params.locations)
    : undefined;

  const { data, error, nextCursor } = await buildProfileQuery({
    searchQuery: null,
    jobRoles: joined(params.roles),
    jobTypes: joined(params.jobTypes),
    locations: joined(locations),
    minExperience: asParam(params.minExperience),
    maxExperience: asParam(params.maxExperience),
    minSalary: null,
    maxSalary: null,
    budget: params.budget ?? null,
    skills: joined(params.skills),
    workStyle: joined(params.workStyle),
    companySize: null,
    industry: null,
    sortBy: "created_at",
    sortOrder: "desc",
    isFavoriteTabActive: false,
    jobEmbedding: null,
    cursor: capped ? null : (params.cursor ?? null),
    limit: capped ? Math.min(params.limit, planLimit) : params.limit,
    relevanceSearchType: null,
    jobId: null,
    companyId,
    isInternalCall: false,
    matchText: true,
  });
  if (error) throw new Error(`Profile search failed: ${error}`);

  return { profiles: data, nextCursor: capped ? null : nextCursor, planLimit };
}
