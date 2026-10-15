import { describe, expect, it } from "vitest";
import {
  activeTabFrom,
  isReservedListSlug,
  slugifyListName,
  talentListPath,
} from "./talent-list-tabs";

describe("slugifyListName (PL-TASK-051)", () => {
  it.each([
    ["Backend shortlist", "backend-shortlist"],
    ["  Q4 / Frontend!! ", "q4-frontend"],
    ["Backend_Shortlist", "backend-shortlist"],
    ["Café Ünïcode", "café-ünïcode"],
    ["बैकएंड", "बैकएंड".normalize("NFKC")],
    ["🚀 Rockets 🚀", "rockets"],
    ["!!!", ""],
  ])("%j → %j", (name, slug) => {
    expect(slugifyListName(name)).toBe(slug);
  });

  it("caps the slug at 60 characters without a trailing hyphen", () => {
    const slug = slugifyListName(`${"a".repeat(59)} b`);
    expect(slug).toBe("a".repeat(59));
  });

  it("knows the built-in tabs", () => {
    expect(isReservedListSlug("all")).toBe(true);
    expect(isReservedListSlug("saved")).toBe(true);
    expect(isReservedListSlug("saved-list")).toBe(false);
  });

  it("links to a list's tab", () => {
    expect(talentListPath("café-q4")).toBe(
      "/company/profiles?tab=caf%C3%A9-q4",
    );
  });
});

describe("activeTabFrom", () => {
  const at = (query: string) =>
    activeTabFrom(new URLSearchParams(query), [{ slug: "backend" }]);

  it("is All, Saved, or one of the company's list slugs", () => {
    expect(at("")).toBe("all");
    expect(at("tab=saved")).toBe("saved");
    expect(at("tab=backend")).toBe("backend");
    expect(at("tab=deleted-list")).toBe("all");
  });
});
