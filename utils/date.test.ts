import { describe, expect, it } from "vitest";
import { formatDate } from "./date";

describe("formatDate", () => {
  it("formats in IST, not the machine's timezone", () => {
    // 20:00 UTC on the 17th is 01:30 IST on the 18th.
    expect(formatDate("2026-10-17T20:00:00Z")).toBe("18 Oct 2026");
  });

  it("takes other formats and locales", () => {
    expect(formatDate("2026-10-17T06:00:00Z", { month: "long", day: "numeric" }, "en-US")).toBe("October 17");
  });

  it("returns an empty string for missing or invalid dates", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate("")).toBe("");
    expect(formatDate("not a date")).toBe("");
  });
});
