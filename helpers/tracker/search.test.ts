import { describe, expect, it } from "vitest";
import { filterByKeyword, matchesKeyword } from "./search";

const item = { jobTitle: "Senior Frontend Engineer", companyName: "Zoë Labs" };

describe("matchesKeyword", () => {
  it("matches everything on a blank search", () => {
    expect(matchesKeyword(item, "")).toBe(true);
    expect(matchesKeyword(item, null)).toBe(true);
    expect(matchesKeyword(item, "   ")).toBe(true);
  });

  it("matches title and company, case- and accent-insensitive, every word", () => {
    expect(matchesKeyword(item, "frontend")).toBe(true);
    expect(matchesKeyword(item, "zoe")).toBe(true);
    expect(matchesKeyword(item, "FRONTEND zoe")).toBe(true);
    expect(matchesKeyword(item, "frontend acme")).toBe(false);
  });

  it("doesn't look at other fields", () => {
    expect(matchesKeyword({ ...item, location: "Remote" } as typeof item, "remote")).toBe(false);
  });

  it("filters a list", () => {
    expect(filterByKeyword([item, { jobTitle: "Designer", companyName: "Acme" }], "acme")).toHaveLength(1);
  });
});
