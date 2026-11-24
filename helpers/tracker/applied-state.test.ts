import { describe, expect, it } from "vitest";
import { appliedJobFor } from "./applied-state";

describe("appliedJobFor (AT-REQ-034)", () => {
  it("reads a tracked card with its label", () => {
    expect(appliedJobFor({ tracked_applications: [{ all_jobs_id: "j1", status: "in_review" }] }, "j1", false)).toEqual({
      all_jobs_id: "j1",
      status: "in_review",
      statusLabel: "In review",
      kind: "tracked",
      trackedStatus: "in_review",
    });
  });

  it("never counts a saved card as applied", () => {
    expect(appliedJobFor({ tracked_applications: [{ all_jobs_id: "j1", status: "saved" }] }, "j1", false)).toBeUndefined();
  });

  it("reads a GetHired application as is", () => {
    expect(appliedJobFor({ applications: [{ all_jobs_id: "j1", status: "reviewed" }] }, "j1", true)).toMatchObject({
      status: "reviewed",
      kind: "application",
      trackedStatus: null,
    });
  });

  it("maps an old external application (spec §7.2)", () => {
    expect(appliedJobFor({ applications: [{ all_jobs_id: "j1", status: "stand_by" }] }, "j1", false)).toMatchObject({
      status: "in_review",
      statusLabel: "In review",
      kind: "tracked",
    });
  });

  it("prefers the tracked card over an old row for the same job", () => {
    const profile = {
      applications: [{ all_jobs_id: "j1", status: "submitted" }],
      tracked_applications: [{ all_jobs_id: "j1", status: "offer" }],
    };
    expect(appliedJobFor(profile, "j1", false)?.trackedStatus).toBe("offer");
  });

  it("is undefined with nothing, or for another job", () => {
    expect(appliedJobFor(undefined, "j1", false)).toBeUndefined();
    expect(appliedJobFor({ tracked_applications: [{ all_jobs_id: "j2", status: "applied" }] }, "j1", false)).toBeUndefined();
  });
});
