import { describe, expect, it } from "vitest";
import { NOT_SCORED_LABEL, needsScreening, needsScreeningAllowance } from "./screening-view";

describe("screening statuses (BI-REQ-036)", () => {
  it("re-queues no screening, stale, failed, skipped and insufficient_info", () => {
    for (const status of [undefined, "stale", "failed", "skipped_quota", "insufficient_info"]) {
      expect(needsScreening(status)).toBe(true);
    }
    for (const status of ["queued", "processing", "completed"]) expect(needsScreening(status)).toBe(false);
  });

  it("needs the allowance only for screenings never charged", () => {
    expect(needsScreeningAllowance(undefined)).toBe(true);
    expect(needsScreeningAllowance("skipped_quota")).toBe(true);
    // Not scored, so never charged.
    expect(needsScreeningAllowance("insufficient_info")).toBe(true);
    expect(needsScreeningAllowance("stale")).toBe(false);
    expect(needsScreeningAllowance("failed")).toBe(false);
  });

  it("labels an unscored candidate", () => {
    expect(NOT_SCORED_LABEL).toBe("Not scored: no resume");
  });
});
