import { describe, expect, it, vi } from "vitest";

vi.mock("@/helpers/seo/sitemap-data", () => ({
  SITEMAP_URL_LIMIT: 45_000,
  getSitemapData: async () => ({ jobCount: 10, staticPaths: ["/"], locationSlugs: [] }),
}));

import robots from "./robots";

describe("robots", () => {
  it("lets AI search and assistant crawlers in with no crawl delay", async () => {
    const { rules } = await robots();
    const ai = (rules as { userAgent: string[]; allow: string; crawlDelay?: number }[]).find(
      (r) => Array.isArray(r.userAgent) && r.userAgent.includes("GPTBot"),
    );

    expect(ai?.userAgent).toEqual(
      expect.arrayContaining(["OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "PerplexityBot", "Google-Extended"]),
    );
    expect(ai?.allow).toBe("/");
    expect(ai?.crawlDelay).toBeUndefined();
  });

  it("still blocks the SEO scrapers", async () => {
    const { rules } = await robots();
    expect(rules).toContainEqual({ userAgent: "AhrefsBot", disallow: "/" });
  });
});
