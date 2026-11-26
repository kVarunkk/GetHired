import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildRequest } from "@/test/utils/request";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const or = vi.fn();

beforeEach(() => {
  or.mockReset().mockResolvedValue({ data: [{ country: "India", city: "Delhi" }], error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: () => ({ select: () => ({ or }) }),
  } as never);
});

const search = (query: string) => GET(buildRequest(`/api/locations?query=${encodeURIComponent(query)}`));

describe("GET /api/locations", () => {
  it("searches in lower case, so each spelling shares one cache entry", async () => {
    const res = await search("  DeLhi ");

    expect(or).toHaveBeenCalledWith("country.ilike.%delhi%,city.ilike.%delhi%");
    expect(await res.json()).toEqual({ data: [{ location: "Delhi" }] });
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("can't add conditions to the service role filter", async () => {
    await search('x%,city.neq.(a)"*\\');

    expect(or).toHaveBeenCalledWith("country.ilike.%x city.neq. a%,city.ilike.%x city.neq. a%");
  });

  it("limits how long a search can be", async () => {
    await search("a".repeat(500));

    const term = "a".repeat(60);
    expect(or).toHaveBeenCalledWith(`country.ilike.%${term}%,city.ilike.%${term}%`);
  });

  it("doesn't query for a search that is only punctuation", async () => {
    const res = await search("%%,()");

    expect(or).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ data: [] });
  });
});
