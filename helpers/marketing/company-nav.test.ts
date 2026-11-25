import { describe, expect, it } from "vitest";
import { COMPANY_NAV } from "./company-nav";
import { COMPANY_LANDING_PAGES, COMPANY_PAGE_KEYS, COMPANY_PAGE_SEO, COMPANY_FAQS } from "./company-pages";
import { COMPANY_FEATURE_PATHS, FAQS, LANDING_PAGES, MARKDOWN_PAGES, pageForMarkdownPath } from "./content";

describe("company feature pages", () => {
  it("are listed in the footer, in the same order", () => {
    expect(COMPANY_NAV.map((l) => l.href)).toEqual(COMPANY_FEATURE_PATHS);
  });

  it("live under /hire with a path matching their key", () => {
    for (const key of COMPANY_PAGE_KEYS) {
      expect(COMPANY_LANDING_PAGES[key].path).toBe(`/hire/${key}`);
    }
  });

  it("each have features, their own FAQ, SEO entry and a markdown version", () => {
    for (const key of COMPANY_PAGE_KEYS) {
      const page = LANDING_PAGES[key];
      expect(page.features?.audience).toBe("company");
      expect(page.features?.items.length).toBeGreaterThanOrEqual(4);
      expect(page.faq).toBe(key);
      expect(FAQS[key]).toBe(COMPANY_FAQS[key]);
      expect(COMPANY_PAGE_SEO[key].keywords.length).toBeGreaterThan(0);
      expect(MARKDOWN_PAGES).toContain(page.path);
      expect(pageForMarkdownPath(`${page.path}.md`)).toBe(page.path);
    }
  });

  it("have a meta description that fits a search result", () => {
    for (const key of COMPANY_PAGE_KEYS) {
      const { length } = LANDING_PAGES[key].description;
      expect(length).toBeGreaterThan(70);
      expect(length).toBeLessThanOrEqual(200);
    }
  });
});
