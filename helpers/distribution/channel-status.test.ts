import { describe, expect, it } from "vitest";
import { buildChannelRows } from "./channel-status";

const channels = [
  { key: "google", name: "Google for Jobs", kind: "index", enabled: true, requires_approval: false },
  { key: "jooble", name: "Jooble", kind: "feed", enabled: true, requires_approval: true },
  { key: "old", name: "Old", kind: "feed", enabled: false, requires_approval: false },
];
const goodJob = {
  title: "Backend Engineer",
  description: "Build and run the services behind our hiring platform. ".repeat(4),
  locations: ["Bengaluru"],
  remote: false,
  applyUrl: "https://x/jobs/1",
  companyName: "Acme",
  companyLogoUrl: "https://x/logo.png",
};
const build = (over: Partial<Parameters<typeof buildChannelRows>[0]> = {}) =>
  buildChannelRows({ channels, settings: [], postings: [], jobStatus: "active", job: goodJob, ...over });
const byKey = (rows: ReturnType<typeof build>, key: string) => rows.find((r) => r.key === key)!;
const approved = [{ channel_key: "jooble", enabled: true, approved_at: "2026-11-17", status: "live" }];

describe("buildChannelRows", () => {
  it("leaves out disabled channels and keeps index always on for an active, eligible job", () => {
    const rows = build();
    expect(rows.map((r) => r.key)).toEqual(["google", "jooble"]);
    expect(byKey(rows, "google")).toMatchObject({ state: "live", reasons: [] });
  });

  it("shows feed channels as off until the company opts in", () => {
    expect(byKey(build(), "jooble").state).toBe("off");
  });

  it("says the job is in the feed while the board hasn't approved GetHired, with no per-company approval", () => {
    const rows = build({ settings: [{ channel_key: "jooble", enabled: true, approved_at: null, status: "live" }] });
    expect(byKey(rows, "jooble")).toMatchObject({
      state: "pending_approval",
      reasons: ["In the feed. Jooble hasn't approved GetHired yet"],
    });
  });

  it("is live for an opted-in feed once the board has approved GetHired", () => {
    const approvedChannels = channels.map((c) => (c.key === "jooble" ? { ...c, requires_approval: false } : c));
    expect(byKey(build({ channels: approvedChannels, settings: approved }), "jooble").state).toBe("live");
  });

  it("checks the job before the board's approval", () => {
    expect(byKey(build({ settings: approved, jobStatus: "inactive" }), "jooble").state).toBe("not_live");
  });

  it("reports a per-job opt-out", () => {
    const postings = [{ channel_key: "jooble", status: "opted_out", reason: null }];
    expect(byKey(build({ settings: approved, postings }), "jooble").state).toBe("opted_out");
  });

  it("is not live for an inactive job, with the cause", () => {
    expect(byKey(build({ jobStatus: "inactive" }), "google")).toMatchObject({
      state: "not_live",
      reasons: ["The job isn't active"],
    });
  });

  it("lists every eligibility reason for a failing job", () => {
    const rows = build({ job: { ...goodJob, locations: [], companyLogoUrl: null } });
    expect(byKey(rows, "google")).toMatchObject({
      state: "not_live",
      reasons: ["Missing location", "Missing company logo"],
    });
  });
});
