import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { expandLocations } from "@/helpers/locations/aliases";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { buildQuery } from "./filterQueryBuilder";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/helpers/locations/aliases", () => ({ expandLocations: vi.fn() }));

const BASE_ARGS = {
  jobType: null,
  visaRequirement: null,
  location: null,
  minSalary: null,
  minExperience: null,
  platform: null,
  companyName: null,
  cursor: null,
  limit: 10,
  sortBy: "created_at",
  sortOrder: "desc",
  jobTitleKeywords: null,
  isFavoriteTabActive: false,
  isAppliedJobsTabActive: false,
  userEmbedding: null,
  applicationStatus: null,
  createdAfter: null,
  isInternalCall: false,
  jobEmbedding: null,
  relevanceSearchType: null,
  userId: null,
} as const;

let supabase: SupabaseMock;

const overlapsCall = () =>
  supabase
    .callsFor("all_jobs")[0]
    ?.chain.find((step) => step.method === "overlaps");

beforeEach(() => {
  supabase = createSupabaseMock();
  supabase.queue("all_jobs", { data: [], error: null, count: 0 });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
  vi.mocked(getUserFromRequest).mockResolvedValue(null);
});

describe("buildQuery: location filter", () => {
  it("filters on the expanded alias group, so every spelling of a place matches", async () => {
    vi.mocked(expandLocations).mockResolvedValue(["bangalore", "bengaluru", "remote"]);

    await buildQuery({ ...BASE_ARGS, location: "Bengaluru|Remote" });

    expect(expandLocations).toHaveBeenCalledWith(["Bengaluru", "Remote"]);
    expect(overlapsCall()).toEqual({
      method: "overlaps",
      args: ["normalized_locations", ["bangalore", "bengaluru", "remote"]],
    });
  });

  it("adds no location filter when none is requested", async () => {
    await buildQuery({ ...BASE_ARGS });

    expect(expandLocations).not.toHaveBeenCalled();
    expect(overlapsCall()).toBeUndefined();
  });
});
