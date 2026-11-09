import { describe, expect, it } from "vitest";
import {
  fillPlaceholders,
  hasPlaceholder,
  placeholdersIn,
  readSuggestions,
  reconcileSuggestions,
  splitPlaceholders,
} from "./suggestions";

describe("placeholders (RE-REQ-059)", () => {
  it.each(["Cut latency by [X%]", "Served [number of users] users", "[a] and [b]"])("finds one in %s", (text) => {
    expect(hasPlaceholder(text)).toBe(true);
  });

  it.each(["Cut latency by 40%", "Empty [] brackets", "An open [ bracket"])("finds none in %s", (text) => {
    expect(hasPlaceholder(text)).toBe(false);
  });

  it("lists them in order", () => {
    expect(placeholdersIn("Cut [X%] across [teams]")).toEqual(["[X%]", "[teams]"]);
    expect(placeholdersIn("None here")).toEqual([]);
  });

  it("gives the same answer every time", () => {
    expect([hasPlaceholder("[a]"), hasPlaceholder("[a]"), hasPlaceholder("[a]")]).toEqual([true, true, true]);
  });
});

describe("reconcileSuggestions (RE-REQ-054a)", () => {
  const VERSION_1 = {
    sections: [{ type: "experience", items: [{ heading: "Dev", bullets: [{ id: "old", text: "Real text" }] }] }],
  };

  it("works on a version 1 resume", () => {
    expect(reconcileSuggestions([{ bullet_id: "old", original: "Misquoted" }], VERSION_1)).toEqual([
      { bullet_id: "old", original: "Real text" },
    ]);
  });

  it("returns nothing for a resume with no bullets", () => {
    expect(reconcileSuggestions([{ bullet_id: "old", original: "x" }], {})).toEqual([]);
  });
});

describe("readSuggestions", () => {
  it.each([[null], [{}], ["text"], [{ bullet_points: "nope" }]])("reads %j as none", (value) => {
    expect(readSuggestions(value)).toEqual([]);
  });

  it("skips a malformed suggestion", () => {
    const good = { bullet_id: "b", original: "o", suggested: "s", section: "x", reason: "r", priority: "low" };
    expect(readSuggestions({ bullet_points: [good, { bullet_id: 1 }, null] })).toEqual([good]);
  });
});

describe("splitPlaceholders (RI-REQ-026)", () => {
  it("splits text around each placeholder", () => {
    expect(splitPlaceholders("Cut [X%] of [N] bills")).toEqual([
      { text: "Cut ", placeholder: false },
      { text: "[X%]", placeholder: true },
      { text: " of ", placeholder: false },
      { text: "[N]", placeholder: true },
      { text: " bills", placeholder: false },
    ]);
  });

  it("is one part with no placeholder, and handles one at either end", () => {
    expect(splitPlaceholders("Plain")).toEqual([{ text: "Plain", placeholder: false }]);
    expect(splitPlaceholders("[A] b [C]").map(({ placeholder }) => placeholder)).toEqual([true, false, true]);
  });
});

describe("fillPlaceholders", () => {
  it("fills in order, and leaves an empty value in place", () => {
    expect(fillPlaceholders("Cut [X%] of [N] bills", ["30%", ""])).toBe("Cut 30% of [N] bills");
    expect(fillPlaceholders("Cut [X%] of [N] bills", ["30%", "12"])).toBe("Cut 30% of 12 bills");
  });

  it("takes a value literally", () => {
    expect(fillPlaceholders("Saved [X]", ["$& more"])).toBe("Saved $& more");
  });

  it("treats blank as unfilled", () => {
    expect(hasPlaceholder(fillPlaceholders("Cut [X%]", ["   "]))).toBe(true);
  });
});
