import { describe, expect, it } from "vitest";
import { isReviewed } from "./reviewed";

describe("isReviewed", () => {
  const completedAt = "2026-11-20T10:00:00.000Z";

  it("is false until someone marks it", () => {
    expect(isReviewed(null, completedAt)).toBe(false);
  });

  it("is true for a review after the interview finished", () => {
    expect(isReviewed("2026-11-21T10:00:00.000Z", completedAt)).toBe(true);
  });

  it("ignores a review of an earlier attempt", () => {
    expect(isReviewed("2026-11-19T10:00:00.000Z", completedAt)).toBe(false);
  });
});
