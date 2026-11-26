import { beforeEach, describe, expect, it, vi } from "vitest";

// Like Next's: keeps what the callback resolves to, and nothing when it throws.
const cache = vi.hoisted(() => new Map<string, unknown>());
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[]) => async () => {
    const key = JSON.stringify(keyParts);
    if (!cache.has(key)) cache.set(key, await fn());
    return cache.get(key);
  },
}));
const publicClient = vi.hoisted(() => ({}));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => publicClient }));
vi.mock("@/helpers/jobs/search-jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/jobs/search-jobs")>()),
  searchJobs: vi.fn(),
}));

import { searchJobs } from "@/helpers/jobs/search-jobs";
import { loadPublicJobsFeed } from "./public-jobs-feed";

const OK = { ok: true as const, data: [], totalCount: 3, nextCursor: null };

beforeEach(() => {
  cache.clear();
  vi.mocked(searchJobs).mockReset().mockResolvedValue(OK);
});

describe("loadPublicJobsFeed", () => {
  it("searches signed out with the public client and the query's filters", async () => {
    await expect(loadPublicJobsFeed("location=Remote&sortBy=salary_min")).resolves.toEqual(OK);
    expect(searchJobs).toHaveBeenCalledWith(
      publicClient,
      null,
      expect.objectContaining({ location: "Remote", sortBy: "salary_min", cursor: null }),
      undefined,
    );
  });

  it("caches per set of filters", async () => {
    await loadPublicJobsFeed("location=Remote");
    await loadPublicJobsFeed("location=Remote");
    await loadPublicJobsFeed("location=Pune");
    expect(searchJobs).toHaveBeenCalledTimes(2);
  });

  it("doesn't cache a refused search", async () => {
    vi.mocked(searchJobs).mockResolvedValueOnce({ ok: false, status: 404, error: "Not found." });
    await expect(loadPublicJobsFeed("")).rejects.toThrow("Not found.");
    await expect(loadPublicJobsFeed("")).resolves.toEqual(OK);
  });

  it("doesn't cache a search that throws", async () => {
    vi.mocked(searchJobs).mockRejectedValueOnce(new Error("statement timeout"));
    await expect(loadPublicJobsFeed("")).rejects.toThrow("statement timeout");
    await expect(loadPublicJobsFeed("")).resolves.toEqual(OK);
  });
});
