import { describe, expect, it } from "vitest";
import { careersApplyPath, jobApplyPath } from "./apply-path";

describe("apply paths (APT-001)", () => {
  it("links a job's apply page, keeping a source tag", () => {
    expect(jobApplyPath("j1")).toBe("/jobs/j1/apply");
    expect(jobApplyPath("j1", { channel: "indeed", pid: "p9" })).toBe("/jobs/j1/apply?src=indeed&pid=p9");
    expect(jobApplyPath("j1", { channel: "google", pid: null })).toBe("/jobs/j1/apply?src=google");
  });

  it("links the careers apply page, keeping ref", () => {
    expect(careersApplyPath("acme", "j1")).toBe("/careers/acme/jobs/j1/apply");
    expect(careersApplyPath("acme", "j1", "linkedin")).toBe("/careers/acme/jobs/j1/apply?ref=linkedin");
  });
});
