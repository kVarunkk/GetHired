import { describe, expect, it } from "vitest";
import { describeGrantChange, describeLimitChange, diffRole, toGrantMap, toLimits } from "./role-diff";

describe("diffRole (RP-REQ-032)", () => {
  const before = {
    grants: toGrantMap([
      { key: "jobs.view", scope: "all" },
      { key: "applicants.view", scope: "all" },
      { key: "notes.view", scope: "all" },
    ]),
    limits: { outreach: 50 },
  };

  it("lists added, removed and rescoped permissions in catalog order, with dependencies added", () => {
    const diff = diffRole(before, {
      grants: toGrantMap([
        { key: "applicants.view", scope: "assigned" },
        { key: "pipeline.move", scope: "assigned" },
      ]),
    });

    expect(diff.grants.map(describeGrantChange)).toEqual([
      "View job posts: all jobs → assigned jobs",
      "View applicants: all jobs → assigned jobs",
      "+ Move applicants (assigned jobs)",
      "− Read notes",
    ]);
    expect(diff.limits).toEqual([]);
  });

  it("lists limit changes, and leaves grants alone when they're unchanged", () => {
    const diff = diffRole(before, { grants: null, limits: { outreach: 20, screenings: 0 } });

    expect(diff.grants).toEqual([]);
    expect(diff.limits.map(describeLimitChange)).toEqual([
      "screenings: no limit → 0 a month",
      "outreach: 50 a month → 20 a month",
    ]);
  });

  it("reads both the RPC and the audit shapes, dropping unknown keys", () => {
    expect([...toGrantMap({ "jobs.view": "all", "billing.manage": "all", "notes.view": "nope" })]).toEqual([
      ["jobs.view", "all"],
    ]);
    expect(toLimits({ outreach: 3, seats: 1 })).toEqual({ outreach: 3 });
  });
});
