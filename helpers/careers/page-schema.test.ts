import { describe, expect, it } from "vitest";
import { accentError, careersPageSchema, contrast, readLinks, readSections } from "./page-schema";

const sid = (n: number) => `5c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const VALID = {
  accentColor: "#4F46E5",
  coverUrl: "https://cdn.acme.test/cover.png",
  sections: [
    { id: sid(1), kind: "about", hidden: false },
    { id: sid(2), kind: "perks", title: "Why join us", hidden: false, items: [{ title: "Remote", text: "Work anywhere." }] },
    { id: sid(3), kind: "custom", title: "Our values", body: "**Ship** it.", hidden: true },
  ],
  links: { linkedin: "https://linkedin.com/company/acme" },
};

describe("careers page schema (CP-REQ-004/009, CP-SEC-002/003)", () => {
  it("accepts a valid page and lowercases the accent", () => {
    const parsed = careersPageSchema.parse(VALID);
    expect(parsed.accentColor).toBe("#4f46e5");
  });

  it.each([
    ["a second About", { sections: [...VALID.sections, { id: sid(4), kind: "about", hidden: false }] }],
    ["four custom sections", { sections: [1, 2, 3, 4].map((n) => ({ id: sid(n), kind: "custom", title: "T", body: "", hidden: false })) }],
    ["13 perks", { sections: [{ ...VALID.sections[1], items: Array.from({ length: 13 }, () => ({ title: "P", text: "" })) }] }],
    ["an http link", { links: { linkedin: "http://linkedin.com/company/acme" } }],
    ["a javascript cover", { coverUrl: "javascript:alert(1)" }],
    ["an unknown link", { links: { myspace: "https://myspace.com/acme" } }],
    ["raw CSS as a colour", { accentColor: "red; background: url(x)" }],
    ["a 10,001-character section", { sections: [{ id: sid(5), kind: "custom", title: "T", body: "x".repeat(10001), hidden: false }] }],
  ])("rejects %s", (_, patch) => {
    expect(careersPageSchema.safeParse({ ...VALID, ...patch }).success).toBe(false);
  });

  it("checks the accent's contrast on light and dark pages", () => {
    expect(accentError("#4f46e5")).toBeNull();
    expect(accentError("#fde047")).toMatch(/too light/);
    expect(accentError("#111111")).toMatch(/too dark/);
    expect(accentError("#4f46e")).toBe("Use a colour like #4f46e5.");
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("reads stored sections and links defensively", () => {
    expect(readSections([VALID.sections[0], { kind: "video" }, "x"])).toEqual([VALID.sections[0]]);
    expect(readSections(null)).toEqual([]);
    expect(readLinks({ linkedin: "https://linkedin.com/company/acme", x: "javascript:1", other: "https://a.b" })).toEqual({
      linkedin: "https://linkedin.com/company/acme",
    });
  });
});
