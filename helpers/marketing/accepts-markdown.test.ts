import { describe, expect, it } from "vitest";
import { acceptsMarkdown, pageForContentNegotiation } from "./content";

describe("acceptsMarkdown", () => {
  it("accepts a client that asks for markdown", () => {
    expect(acceptsMarkdown("text/markdown")).toBe(true);
    expect(acceptsMarkdown("text/markdown, text/html;q=0.8")).toBe(true);
    expect(acceptsMarkdown("text/html;q=0.5, text/markdown")).toBe(true);
  });

  it("refuses browsers, wildcards and equal rankings", () => {
    expect(acceptsMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(false);
    expect(acceptsMarkdown("*/*")).toBe(false);
    expect(acceptsMarkdown("text/markdown, text/html")).toBe(false);
    expect(acceptsMarkdown("text/markdown;q=0")).toBe(false);
    expect(acceptsMarkdown(null)).toBe(false);
    expect(acceptsMarkdown("")).toBe(false);
  });
});

describe("pageForContentNegotiation", () => {
  it("covers the pages that have a markdown version, and the home page", () => {
    expect(pageForContentNegotiation("/")).toBe("/");
    expect(pageForContentNegotiation("/hire")).toBe("/hire");
    expect(pageForContentNegotiation("/blog/some-post")).toBe("/blog/some-post");
    expect(pageForContentNegotiation("/dashboard")).toBeNull();
  });
});
