import { describe, expect, it } from "vitest";
import { jobPostPath } from "./paths";

describe("jobPostPath (CPT-054)", () => {
  it("opens a new job with the created flag", () => {
    expect(jobPostPath("j1")).toBe("/company/job-posts/j1");
    expect(jobPostPath("j1", { created: true })).toBe("/company/job-posts/j1?created=1");
  });
});
