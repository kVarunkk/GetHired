import { beforeEach, describe, expect, it, vi } from "vitest";
import JobsPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { buildCompaniesQuery } from "@/helpers/companies/companiesFilterQueryBuilder";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/companies/companiesFilterQueryBuilder", () => ({ buildCompaniesQuery: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/components/FilterComponent", () => ({ default: () => null }));
vi.mock("@/components/ClientTabs", () => ({ ClientTabs: () => null }));
vi.mock("@/components/JobsComponent", () => ({ default: () => null }));

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as never);
  vi.mocked(buildCompaniesQuery).mockReset().mockResolvedValue({ data: [], error: undefined, count: 0, matchedCompanyIds: [] });
});

const open = (searchParams: Record<string, string> = {}) =>
  JobsPage({ searchParams: Promise.resolve(searchParams) });

describe("/companies", () => {
  it("queries the companies itself, without calling its own API", async () => {
    await open();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(buildCompaniesQuery).toHaveBeenCalledWith(
      expect.objectContaining({ start_index: 0, end_index: 19, isFavoriteTabActive: false, userEmbedding: null }),
    );
  });

  it("passes the URL's filters, page and tab on", async () => {
    await open({ industry: "Software", location: "Pune", page: "2", tab: "saved", sortBy: "name", sortOrder: "asc" });

    expect(buildCompaniesQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        industry: "Software",
        location: "Pune",
        start_index: 20,
        end_index: 39,
        isFavoriteTabActive: true,
        sortBy: "name",
        sortOrder: "asc",
      }),
    );
  });
});
