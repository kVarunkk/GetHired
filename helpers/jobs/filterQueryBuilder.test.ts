import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { expandLocations } from "@/helpers/locations/aliases";
import {
  createSupabaseMock,
  type SupabaseMock,
} from "@/test/utils/supabase-mock";
import { buildQuery } from "./filterQueryBuilder";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({
  getUserFromRequest: vi.fn(),
}));
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
    vi.mocked(expandLocations).mockResolvedValue([
      "bangalore",
      "bengaluru",
      "remote",
    ]);

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

describe("buildQuery: total", () => {
  const selectOf = () =>
    supabase
      .callsFor("all_jobs")[0]
      .chain.find((step) => step.method === "select")!;

  it("counts the filtered query itself, not every job", async () => {
    supabase = createSupabaseMock();
    supabase.queue("all_jobs", { data: [], error: null, count: 12 });
    vi.mocked(createClient).mockResolvedValue(supabase.client);

    const result = await buildQuery({ ...BASE_ARGS, jobType: "Fulltime" });

    expect(supabase.callsFor("all_jobs")).toHaveLength(1);
    expect(selectOf().args[1]).toEqual({ count: "exact" });
    expect(result.count).toBe(12);
  });

  it("doesn't count again on later pages", async () => {
    await buildQuery({
      ...BASE_ARGS,
      cursor: Buffer.from("2026-10-01_j1").toString("base64"),
    });

    expect(selectOf().args[1]).toBeUndefined();
  });
});

describe("buildQuery: cursor", () => {
  const cursorOf = (value: string, id: string) =>
    Buffer.from(`${value}_${id}`).toString("base64");
  const chain = () => supabase.callsFor("all_jobs")[0]!.chain;

  it("continues after the last row, ties by id, then the nulls", async () => {
    await buildQuery({
      ...BASE_ARGS,
      sortBy: "salary_min",
      sortOrder: "desc",
      cursor: cursorOf("50000", "j9"),
    });

    expect(chain()).toContainEqual({
      method: "or",
      args: [
        'salary_min.lt."50000",and(salary_min.eq."50000",id.lt.j9),salary_min.is.null',
      ],
    });
  });

  it("breaks ties by id in the sort direction when ascending", async () => {
    await buildQuery({
      ...BASE_ARGS,
      sortBy: "salary_min",
      sortOrder: "asc",
      cursor: cursorOf("50000", "j9"),
    });

    expect(chain()).toContainEqual({
      method: "or",
      args: [
        'salary_min.gt."50000",and(salary_min.eq."50000",id.gt.j9),salary_min.is.null',
      ],
    });
  });

  it("only returns later nulls once the last row was null, so no row repeats", async () => {
    await buildQuery({
      ...BASE_ARGS,
      sortBy: "salary_min",
      sortOrder: "desc",
      cursor: cursorOf("null", "j9"),
    });

    expect(chain()).toContainEqual({
      method: "is",
      args: ["salary_min", null],
    });
    expect(chain()).toContainEqual({
      method: "filter",
      args: ["id", "lt", "j9"],
    });
    expect(chain().filter((step) => step.method === "or")).toEqual([]);
  });

  it("quotes values with commas and keeps non-ASCII text", async () => {
    await buildQuery({
      ...BASE_ARGS,
      sortBy: "company_name",
      sortOrder: "asc",
      cursor: cursorOf("Acme, Inc_Café", "j9"),
    });

    expect(chain()).toContainEqual({
      method: "or",
      args: [
        'company_name.gt."Acme, Inc_Café",and(company_name.eq."Acme, Inc_Café",id.gt.j9),company_name.is.null',
      ],
    });
  });
});
