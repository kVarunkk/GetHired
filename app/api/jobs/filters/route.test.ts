import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { createPublicClient } from "@/lib/supabase/public";
import { buildRequest } from "@/test/utils/request";

vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/helpers/posthog/report-error", () => ({ reportError: vi.fn() }));

const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: [{ company_name: "Zeta" }], error: null });
  vi.mocked(createPublicClient).mockReturnValue({ rpc } as never);
});

describe("GET /api/jobs/filters", () => {
  it("searches in lower case, so each spelling shares one cache entry", async () => {
    const res = await GET(buildRequest("/api/jobs/filters?query=%20%20ZeTa%20"));

    expect(rpc).toHaveBeenCalledWith("search_job_companies", { p_query: "zeta" });
    expect(await res.json()).toEqual({ companies: [{ company_name: "Zeta" }] });
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
  });

  it("asks for the default list without a search", async () => {
    await GET(buildRequest("/api/jobs/filters"));

    expect(rpc).toHaveBeenCalledWith("search_job_companies", { p_query: "" });
  });

  it("limits how long a search can be", async () => {
    await GET(buildRequest(`/api/jobs/filters?query=${"a".repeat(500)}`));

    expect(rpc).toHaveBeenCalledWith("search_job_companies", { p_query: "a".repeat(60) });
  });

  it("answers 500 when the search fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "timeout" } });

    const res = await GET(buildRequest("/api/jobs/filters?query=a"));

    expect(res.status).toBe(500);
  });
});
