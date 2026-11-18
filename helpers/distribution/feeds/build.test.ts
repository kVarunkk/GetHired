import { describe, expect, it } from "vitest";
import { buildFeed, isFeedPlatform } from "./build";

describe("buildFeed", () => {
  it("knows the feed platforms", () => {
    expect(isFeedPlatform("jooble")).toBe(true);
    expect(isFeedPlatform("indeed")).toBe(false);
    expect(isFeedPlatform("../x")).toBe(false);
  });

  it("builds a well-formed empty feed for each platform", () => {
    for (const p of ["jooble", "adzuna", "talent", "ziprecruiter"] as const) {
      expect(buildFeed(p, [])).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    }
  });
});
