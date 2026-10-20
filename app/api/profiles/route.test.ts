import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProfileQuery } from "@/helpers/profiles/profilesFilterQueryBuilder";
import { rerankProfilesIfApplicable } from "@/helpers/profiles/ai-rerank-profiles";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { listPublicPlans } from "@/helpers/billing/plans";
import { setRequestUser } from "@/test/utils/auth";
import { TIER_FREE, TIER_STARTUP, entitlementsOf } from "@/test/utils/billing";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { OWNER_A } from "@/test/utils/team";
import { expandProfileLocations } from "@/helpers/locations/aliases";
import { GET } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/profiles/profilesFilterQueryBuilder", () => ({ buildProfileQuery: vi.fn() }));
vi.mock("@/helpers/profiles/ai-rerank-profiles", () => ({ rerankProfilesIfApplicable: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/helpers/billing/entitlements")>();
  return { getEntitlements: vi.fn(), suggestedTierFor: actual.suggestedTierFor };
});
vi.mock("@/helpers/billing/plans", () => ({ listPublicPlans: vi.fn() }));
vi.mock("@/helpers/locations/aliases", () => ({ expandProfileLocations: vi.fn() }));
vi.mock("server-only", () => ({}));

/** getEntitlements' shape, from the fixture's raw RPC result. */
function mapped(raw: ReturnType<typeof entitlementsOf>) {
  return {
    tier: { id: raw.tier_id, slug: raw.tier_slug, name: raw.tier_slug },
    creditBalance: raw.credit_balance,
    entitlements: Object.fromEntries(
      Object.entries(raw.entitlements).map(([k, e]) => [k, { ...e, overageCredits: e.overage_credits }]),
    ),
  };
}

let rls: SupabaseMock;
const PROFILES = Array.from({ length: 20 }, (_, i) => ({ user_id: `u${i}` }));

async function signIn(tier = TIER_FREE) {
  rls = createSupabaseMock({ user: COMPANY_A.user });
  rls.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  rls.queue("company_info", {
    data: { id: COMPANY_A.id, ai_credits: 0, filled: true, job_postings: [] },
    error: null,
  });
  vi.mocked(getEntitlements).mockResolvedValue(mapped(entitlementsOf(tier)) as never);
  vi.mocked(listPublicPlans).mockResolvedValue(
    [TIER_FREE, TIER_STARTUP].map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: null,
      features: [],
      sort: t.sort,
      prices: [],
      entitlements: Object.fromEntries(
        t.entitlements.map((e) => [e.key, { kind: e.kind, amount: e.amount, overageCredits: e.overage_credits }]),
      ),
    })),
  );
  await setRequestUser(COMPANY_A.user, rls.client);
}

beforeEach(() => {
  vi.mocked(buildProfileQuery).mockResolvedValue({
    data: PROFILES,
    error: null,
    nextCursor: "cursor-2",
    count: 57,
    matchedProfileIds: [],
  } as never);
  vi.mocked(rerankProfilesIfApplicable).mockImplementation(async ({ initialProfiles, initialCount }) => ({
    initialProfiles,
    totalCount: initialCount,
  }) as never);
});

const get = (params: Record<string, string> = {}) =>
  GET(buildRequest("/api/profiles", { searchParams: params }));

describe("GET /api/profiles (BL-REQ-023, BL-TEST-006)", () => {
  it("caps results at profiles_per_search, turns off pagination and reports the rest", async () => {
    await signIn(TIER_FREE);

    const body = await (await get({ limit: "50" })).json();

    expect(getEntitlements).toHaveBeenCalledWith(COMPANY_A.id);
    expect(vi.mocked(buildProfileQuery).mock.calls[0][0]).toMatchObject({ limit: 20 });
    expect(body.nextCursor).toBeNull();
    expect(body.hiddenCount).toBe(37);
    expect(body.profilesPerSearch).toBe(20);
    expect(body.upgradePlan).toEqual({ slug: "startup", name: "Startup" });
  });

  it("doesn't read company_tiers", async () => {
    await signIn(TIER_FREE);
    await get();

    const select = String(rls.callsFor("company_info")[0].chain.find((m) => m.method === "select")?.args[0]);
    expect(select).not.toContain("company_tiers");
  });

  it("paginates normally when unlimited, with no hiddenCount", async () => {
    await signIn(TIER_STARTUP);

    const body = await (await get({ limit: "30" })).json();

    expect(vi.mocked(buildProfileQuery).mock.calls[0][0]).toMatchObject({ limit: 30 });
    expect(body.nextCursor).toBe("cursor-2");
    expect(body).not.toHaveProperty("hiddenCount");
  });
});

describe("GET /api/profiles matchScores (MT-TASK-001)", () => {
  const scores = { u0: { skills: 3, experience: 3, preferenceConflict: 0, aggregate: 3 } };
  const JOB_ID = "b0000000-0000-4000-8000-000000000001";

  beforeEach(() => {
    vi.mocked(rerankProfilesIfApplicable).mockImplementation(async ({ initialProfiles, initialCount }) => ({
      initialProfiles,
      totalCount: initialCount,
      matchScores: scores,
    }) as never);
  });

  it("returns the rerank's scores on a digest", async () => {
    await signIn(TIER_STARTUP);

    const body = await (
      await get({ sortBy: "relevance", job_post: JOB_ID, type: "digest", userId: COMPANY_A.user.id })
    ).json();

    expect(body.matchScores).toEqual(scores);
  });

  it.each([
    ["a normal search", {}],
    ["a standard relevance read", { sortBy: "relevance", job_post: JOB_ID }],
  ])("leaves them out of %s", async (_label, params) => {
    await signIn(TIER_STARTUP);

    const body = await (await get(params)).json();

    expect(body).not.toHaveProperty("matchScores");
  });
});

describe("GET /api/profiles filters", () => {
  it("matches text filters by substring and every spelling of a location", async () => {
    await signIn(TIER_STARTUP);
    vi.mocked(expandProfileLocations).mockResolvedValue(["bangalore", "bengaluru", "Bengaluru"]);

    await get({ location: "Bengaluru", skills: "react|node" });

    expect(expandProfileLocations).toHaveBeenCalledWith(["Bengaluru"]);
    expect(vi.mocked(buildProfileQuery).mock.calls[0][0]).toMatchObject({
      locations: "bangalore|bengaluru|Bengaluru",
      skills: "react|node",
      matchText: true,
    });
  });

  it("skips location expansion without a location filter", async () => {
    await signIn(TIER_STARTUP);
    await get();

    expect(expandProfileLocations).not.toHaveBeenCalled();
    expect(vi.mocked(buildProfileQuery).mock.calls[0][0]).toMatchObject({ locations: null });
  });

  it("resolves a talent list's tab from its slug, within the company (PL-TASK-051)", async () => {
    await signIn(TIER_STARTUP);
    rls.queue("talent_lists", { data: { id: "a1000000-0000-4000-8000-00000000000a" }, error: null });
    await get({ tab: "backend-shortlist" });

    expect(vi.mocked(buildProfileQuery).mock.calls[0][0]).toMatchObject({
      isFavoriteTabActive: false,
      talentListId: "a1000000-0000-4000-8000-00000000000a",
    });
    const [lookup] = rls.callsFor("talent_lists");
    expect(lookup.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(lookup.chain).toContainEqual({ method: "eq", args: ["slug", "backend-shortlist"] });
  });

  it("shows everyone for an unknown list, and never looks up the built-in tabs", async () => {
    await signIn(TIER_STARTUP);
    rls.queue("talent_lists", { data: null, error: null });
    await get({ tab: "deleted-list" });
    expect(vi.mocked(buildProfileQuery).mock.calls[0][0]).toMatchObject({
      isFavoriteTabActive: false,
      talentListId: null,
    });

    await signIn(TIER_STARTUP);
    await get({ tab: "saved" });
    expect(vi.mocked(buildProfileQuery).mock.calls[1][0]).toMatchObject({
      isFavoriteTabActive: true,
      talentListId: null,
    });
    expect(rls.callsFor("talent_lists")).toHaveLength(0);
  });
});
