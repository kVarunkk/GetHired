import { describe, expect, it } from "vitest";
import { appliedAgo, daysSince, isFollowUpDue, newestApplications, shortDate, sourceMark } from "./card";

const NOW = new Date(2026, 10, 24, 12); // Nov 24, 2026, local noon

describe("card helpers", () => {
  it("counts whole days since applying", () => {
    expect(daysSince("2026-11-24", NOW)).toBe(0);
    expect(daysSince("2026-11-23", NOW)).toBe(1);
    expect(daysSince("2026-10-25", NOW)).toBe(30);
    expect(daysSince("2026-12-01", NOW)).toBe(0);
    expect(appliedAgo("2026-11-24", NOW)).toBe("Applied today");
    expect(appliedAgo("2026-11-23", NOW)).toBe("Applied 1 day ago");
    expect(appliedAgo("2026-11-12", NOW)).toBe("Applied 12 days ago");
  });

  it("marks a follow-up due on or before today", () => {
    expect(isFollowUpDue("2026-11-24", NOW)).toBe(true);
    expect(isFollowUpDue("2026-11-01", NOW)).toBe(true);
    expect(isFollowUpDue("2026-11-25", NOW)).toBe(false);
    expect(isFollowUpDue(null, NOW)).toBe(false);
  });

  it("names the source", () => {
    expect(sourceMark({ kind: "gethired", jobUrl: null })).toBe("GetHired");
    expect(sourceMark({ kind: "tracked", jobUrl: "https://www.lever.co/a/1" })).toBe("lever.co");
    expect(sourceMark({ kind: "tracked", jobUrl: null })).toBeNull();
  });

  it("formats short dates", () => {
    expect(shortDate("2026-11-24", NOW)).toBe("Nov 24");
    expect(shortDate("2025-03-02", NOW)).toBe("Mar 2, 2025");
  });
});

describe("newestApplications (AT-REQ-024)", () => {
  it("keeps the three newest by applied date, ties by update", () => {
    const item = (id: string, appliedAt: string, updatedAt = "2026-01-01") => ({ id, appliedAt, updatedAt });
    const result = newestApplications([
      item("old", "2026-01-01"),
      item("b", "2026-03-02", "2026-03-05"),
      item("a", "2026-03-02", "2026-03-09"),
      item("new", "2026-04-01"),
    ]);
    expect(result.map((each) => each.id)).toEqual(["new", "a", "b"]);
  });
});
