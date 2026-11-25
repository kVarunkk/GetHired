import { describe, expect, it } from "vitest";
import type { SavedJobItem, TrackerItem } from "@/helpers/tracker/types";
import { gethiredItem, trackerItem as baseItem } from "@/test/utils/tracker";
import {
  attentionItems,
  dashboardHeadline,
  gotResponse,
  pipelineOf,
  profileProgress,
  savedNotApplied,
  type ProfileFields,
} from "./summary";

const NOW = new Date("2026-11-25T12:00:00");

const trackerItem = (overrides: Partial<TrackerItem> = {}) =>
  baseItem({ appliedAt: "2026-11-20", statusChangedAt: "2026-11-20T10:00:00Z", ...overrides });
const gethired = (overrides: Partial<TrackerItem> = {}) =>
  gethiredItem({ appliedAt: "2026-11-20", statusChangedAt: "2026-11-20T10:00:00Z", allJobsId: "j1", ...overrides });

describe("attentionItems", () => {
  it("lists due follow-ups first, oldest first, and skips future and closed ones", () => {
    const items = [
      trackerItem({ id: "today", nextFollowUpAt: "2026-11-25" }),
      trackerItem({ id: "overdue", nextFollowUpAt: "2026-11-20" }),
      trackerItem({ id: "future", nextFollowUpAt: "2026-11-30" }),
      trackerItem({ id: "closed", nextFollowUpAt: "2026-11-20", status: "rejected", column: "closed" }),
    ];
    const result = attentionItems(items, NOW);
    expect(result.map((a) => a.item.id)).toEqual(["overdue", "today"]);
    expect(result[0].reason).toEqual({ kind: "follow_up", due: "2026-11-20", overdue: true });
    expect(result[1].reason).toMatchObject({ overdue: false });
  });

  it("flags tracked cards unchanged for 30 days, longest first", () => {
    const items = [
      trackerItem({ id: "fresh", statusChangedAt: "2026-11-10T00:00:00Z" }),
      trackerItem({ id: "old", statusChangedAt: "2026-10-01T00:00:00Z" }),
      trackerItem({ id: "older", statusChangedAt: "2026-09-01T00:00:00Z", status: "in_review", column: "in_review" }),
      trackerItem({ id: "interviewing", statusChangedAt: "2026-09-01T00:00:00Z", status: "interviewing", column: "interviewing" }),
    ];
    const result = attentionItems(items, NOW);
    expect(result.map((a) => a.item.id)).toEqual(["older", "old"]);
    expect(result[1].reason).toEqual({ kind: "no_reply", days: 55 });
  });

  it("shows GetHired applications a company moved this week, never the user's own moves", () => {
    const items = [
      gethired({ id: "moved", column: "in_review", statusLabel: "In review", statusChangedAt: "2026-11-24T09:00:00Z" }),
      gethired({ id: "stale", column: "in_review", statusChangedAt: "2026-11-01T09:00:00Z" }),
      gethired({ id: "submitted", column: "applied", statusChangedAt: "2026-11-24T09:00:00Z" }),
      trackerItem({ id: "own", status: "in_review", column: "in_review", statusChangedAt: "2026-11-24T09:00:00Z" }),
    ];
    expect(attentionItems(items, NOW)).toEqual([
      { item: items[0], reason: { kind: "update", label: "In review", changedAt: "2026-11-24T09:00:00Z" } },
    ]);
  });

  it("lists an item once, under its most pressing reason", () => {
    const item = trackerItem({ nextFollowUpAt: "2026-11-25", statusChangedAt: "2026-09-01T00:00:00Z" });
    expect(attentionItems([item], NOW).map((a) => a.reason.kind)).toEqual(["follow_up"]);
  });
});

describe("dashboardHeadline", () => {
  it("joins what's waiting", () => {
    const attention = attentionItems(
      [trackerItem({ id: "a", nextFollowUpAt: "2026-11-25" }), trackerItem({ id: "b", nextFollowUpAt: "2026-11-24" })],
      NOW,
    );
    expect(dashboardHeadline({ attention, scheduledInterviews: 1, screeningInterviews: 0 })).toBe(
      "1 upcoming interview · 2 follow-ups due",
    );
  });

  it("says when there's nothing", () => {
    expect(dashboardHeadline({ attention: [], scheduledInterviews: 0, screeningInterviews: 0 })).toBe("You're all caught up.");
  });
});

describe("pipelineOf", () => {
  it("counts each column, the reply rate and this week's applications", () => {
    const items = [
      trackerItem({ appliedAt: "2026-11-25" }),
      trackerItem({ appliedAt: "2026-11-19", column: "in_review", status: "in_review" }),
      trackerItem({ appliedAt: "2026-11-18", column: "interviewing", status: "interviewing" }),
      trackerItem({ appliedAt: "2026-10-01", column: "closed", status: "ghosted" }),
    ];
    const pipeline = pipelineOf(items, NOW);
    expect(pipeline.stages.map((s) => [s.column, s.count])).toEqual([
      ["applied", 1],
      ["in_review", 1],
      ["interviewing", 1],
      ["offer", 0],
      ["closed", 1],
    ]);
    expect(pipeline).toMatchObject({ total: 4, responded: 2, responseRate: 50, thisWeek: 2 });
  });

  it("holds the reply rate back until there are a few applications", () => {
    expect(pipelineOf([trackerItem(), trackerItem()], NOW).responseRate).toBeNull();
  });

  it("counts a rejection as a reply, but not withdrawn or ghosted", () => {
    expect(gotResponse(trackerItem({ column: "closed", status: "rejected" }))).toBe(true);
    expect(gotResponse(trackerItem({ column: "closed", status: "withdrawn" }))).toBe(false);
    expect(gotResponse(gethired({ column: "closed", gethiredStatus: "rejected" }))).toBe(true);
    expect(gotResponse(gethired({ column: "applied" }))).toBe(false);
  });
});

describe("savedNotApplied", () => {
  const favorite = (id: string, savedAt: string): SavedJobItem => ({
    kind: "favorite",
    id,
    allJobsId: id,
    jobTitle: "Job",
    companyName: "Co",
    location: null,
    savedAt,
  });

  it("leaves out favorites already applied to, newest saved first", () => {
    const saved = [favorite("j1", "2026-11-01"), favorite("j2", "2026-11-03"), favorite("j3", "2026-11-02")];
    const result = savedNotApplied(saved, [gethired({ allJobsId: "j2" })], 5);
    expect(result.map((item) => item.id)).toEqual(["j3", "j1"]);
  });
});

describe("profileProgress", () => {
  const empty: ProfileFields = {
    hasResume: false,
    desired_roles: null,
    top_skills: [],
    preferred_locations: null,
    min_salary: null,
    max_salary: null,
    experience_years: null,
    linkedin_url: null,
    github_url: null,
  };

  it("lists what's missing in order", () => {
    const progress = profileProgress({ ...empty, hasResume: true, top_skills: ["React"], max_salary: 100 });
    expect(progress).toMatchObject({ done: 3, total: 7, percent: 43 });
    expect(progress.missing.map((m) => m.id)).toEqual(["roles", "experience", "locations", "links"]);
  });

  it("counts zero years of experience as filled in", () => {
    expect(profileProgress({ ...empty, experience_years: 0 }).missing.map((m) => m.id)).not.toContain("experience");
  });
});
