import { describe, expect, it } from "vitest";
import { screeningCardState, visibleOnDashboard } from "./dashboard-state";
import type { MyScreeningInterview } from "./my-interviews";

const NOW = new Date("2026-10-19T12:00:00.000Z");
const base = (overrides: Partial<MyScreeningInterview> = {}) =>
  ({
    id: "ai-1",
    status: "invited",
    attempts_used: 0,
    max_attempts: 2,
    deadline_at: "2026-10-24T12:00:00.000Z",
    completed_at: null,
    company_name: "Acme",
    job_title: "Backend Engineer",
    ...overrides,
  }) as MyScreeningInterview;

describe("screeningCardState (SIT-054)", () => {
  it("invited: due in N days with a start CTA", () => {
    expect(screeningCardState(base(), NOW)).toEqual({
      label: "AI interview due in 5 days",
      tone: "action",
      cta: { label: "Start interview", href: "/interview/screening/ai-1" },
    });
  });

  it.each([
    ["2026-10-20T13:00:00.000Z", "AI interview due in 1 day"],
    ["2026-10-20T11:00:00.000Z", "AI interview due today"],
    ["2026-10-19T18:00:00.000Z", "AI interview due today"],
    ["2026-10-19T11:00:00.000Z", "AI interview due today"],
  ])("deadline %s reads %s", (deadline_at, label) => {
    expect(screeningCardState(base({ deadline_at }), NOW).label).toBe(label);
  });

  it("an interrupted attempt offers the retry", () => {
    expect(screeningCardState(base({ attempts_used: 1 }), NOW)).toMatchObject({
      label: "AI interview interrupted: 1 attempt left, due in 5 days",
      cta: { label: "Try again" },
    });
  });

  it("in progress, paused and completed", () => {
    expect(screeningCardState(base({ status: "in_progress", attempts_used: 1 }), NOW)).toMatchObject({
      label: "AI interview in progress",
      cta: { label: "Open" },
    });
    expect(screeningCardState(base({ status: "paused" }), NOW)).toMatchObject({
      label: "Alternative format requested: waiting for Acme",
      tone: "muted",
    });
    expect(screeningCardState(base({ status: "completed" }), NOW)).toMatchObject({
      label: "AI interview submitted",
      tone: "done",
      cta: { label: "View transcript" },
    });
  });

  it("shows open interviews and those submitted in the last 14 days only", () => {
    expect(visibleOnDashboard(base(), NOW)).toBe(true);
    expect(visibleOnDashboard(base({ status: "paused" }), NOW)).toBe(true);
    expect(visibleOnDashboard(base({ status: "completed", completed_at: "2026-10-10T00:00:00.000Z" }), NOW)).toBe(true);
    expect(visibleOnDashboard(base({ status: "completed", completed_at: "2026-09-01T00:00:00.000Z" }), NOW)).toBe(false);
    for (const status of ["expired", "declined", "cancelled", "withdrawn"]) {
      expect(visibleOnDashboard(base({ status }), NOW)).toBe(false);
    }
  });
});
