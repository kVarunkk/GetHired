import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchProfiles } from "./search-profiles";
import { buildProfileQuery } from "./profilesFilterQueryBuilder";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { expandProfileLocations } from "@/helpers/locations/aliases";
import { COMPANY_A } from "@/test/utils/recruiter";

vi.mock("server-only", () => ({}));
vi.mock("./profilesFilterQueryBuilder", () => ({ buildProfileQuery: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));
vi.mock("@/helpers/locations/aliases", () => ({
  expandProfileLocations: vi.fn(),
}));

const PROFILES = [{ user_id: "a1" }, { user_id: "a2" }];

const withCap = (amount: number | null) =>
  vi.mocked(getEntitlements).mockResolvedValue({
    entitlements: { profiles_per_search: { kind: "limit", amount } },
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
  withCap(null);
  vi.mocked(buildProfileQuery).mockResolvedValue({
    data: PROFILES,
    error: undefined,
    nextCursor: "next",
    count: 900,
    matchedProfileIds: [],
  } as never);
  vi.mocked(expandProfileLocations).mockResolvedValue(["bangalore", "bengaluru", "Bengaluru"]);
});

describe("searchProfiles (RAT-022)", () => {
  it("passes the filters to buildProfileQuery for the company, newest first", async () => {
    const result = await searchProfiles(COMPANY_A.id, {
      roles: ["Backend Engineer"],
      skills: ["Go", "Postgres"],
      locations: ["Bangalore"],
      minExperience: 3,
      maxExperience: 8,
      budget: 4000000,
      jobTypes: ["Fulltime"],
      workStyle: ["Remote"],
      limit: 10,
    });

    expect(buildProfileQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        searchQuery: null,
        jobRoles: "Backend Engineer",
        skills: "Go|Postgres",
        locations: "bangalore|bengaluru|Bengaluru",
        minExperience: "3",
        maxExperience: "8",
        budget: 4000000,
        jobTypes: "Fulltime",
        workStyle: "Remote",
        sortBy: "created_at",
        sortOrder: "desc",
        limit: 10,
        cursor: null,
        relevanceSearchType: null,
        isFavoriteTabActive: false,
        companyId: COMPANY_A.id,
        isInternalCall: false,
        matchText: true,
      }),
    );
    expect(result).toEqual({ profiles: PROFILES, nextCursor: "next", planLimit: null });
  });

  it("caps the page at the plan's profiles per search and drops the cursor", async () => {
    withCap(5);

    const result = await searchProfiles(COMPANY_A.id, { limit: 10, cursor: "c1" });

    expect(buildProfileQuery).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, cursor: null }),
    );
    expect(result).toMatchObject({ nextCursor: null, planLimit: 5 });
  });

  it("passes the cursor through when the plan doesn't cap the search", async () => {
    await searchProfiles(COMPANY_A.id, { limit: 10, cursor: "c1" });

    expect(buildProfileQuery).toHaveBeenCalledWith(expect.objectContaining({ cursor: "c1" }));
  });

  it("throws when the plan or the query fails", async () => {
    vi.mocked(getEntitlements).mockRejectedValueOnce(new Error("down"));
    await expect(searchProfiles(COMPANY_A.id, { limit: 10 })).rejects.toThrow();

    vi.mocked(buildProfileQuery).mockResolvedValueOnce({
      data: [],
      error: "boom",
      nextCursor: null,
      count: 0,
      matchedProfileIds: [],
    } as never);
    await expect(searchProfiles(COMPANY_A.id, { limit: 10 })).rejects.toThrow();
  });
});
