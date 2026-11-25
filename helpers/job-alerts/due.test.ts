import { describe, expect, it } from "vitest";
import { alertWindowStart, isAlertDue } from "./due";

const hoursBefore = (now: Date, hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();

// 2026-11-25 is a Wednesday; 2026-11-23 a Monday.
const WEDNESDAY = new Date("2026-11-25T03:30:00Z");
const SUNDAY_LATE = new Date("2026-11-22T23:59:00Z");
const MONDAY_START = new Date("2026-11-23T00:00:00Z");
const TUESDAY = new Date("2026-11-24T03:30:00Z");

describe("isAlertDue (JAT-013, JA-TST-004)", () => {
  it("runs a daily alert checked more than 20 hours ago", () => {
    expect(isAlertDue({ frequency: "daily", last_checked_at: hoursBefore(WEDNESDAY, 21) }, WEDNESDAY)).toBe(true);
    expect(isAlertDue({ frequency: "daily", last_checked_at: hoursBefore(WEDNESDAY, 19) }, WEDNESDAY)).toBe(false);
  });

  it("runs a never-checked alert", () => {
    expect(isAlertDue({ frequency: "daily", last_checked_at: null }, WEDNESDAY)).toBe(true);
    expect(isAlertDue({ frequency: "weekly", last_checked_at: null }, MONDAY_START)).toBe(true);
  });

  it("runs weekly alerts on Mondays (UTC) only", () => {
    const last = (now: Date) => ({ frequency: "weekly", last_checked_at: hoursBefore(now, 24 * 7) });
    expect(isAlertDue(last(SUNDAY_LATE), SUNDAY_LATE)).toBe(false);
    expect(isAlertDue(last(MONDAY_START), MONDAY_START)).toBe(true);
    expect(isAlertDue(last(TUESDAY), TUESDAY)).toBe(false);
    expect(isAlertDue({ frequency: "weekly", last_checked_at: hoursBefore(MONDAY_START, 2) }, MONDAY_START)).toBe(
      false,
    );
  });
});

describe("alertWindowStart (JA-TST-004)", () => {
  const now = WEDNESDAY;

  it("starts at the last check", () => {
    const last = hoursBefore(now, 24);
    expect(alertWindowStart({ last_checked_at: last, created_at: hoursBefore(now, 24 * 30) }, now).toISOString()).toBe(
      last,
    );
  });

  it("starts at creation for a new alert", () => {
    const created = hoursBefore(now, 3);
    expect(alertWindowStart({ last_checked_at: null, created_at: created }, now).toISOString()).toBe(created);
  });

  it("never looks back more than 14 days (a 60-day-old paused alert)", () => {
    const start = alertWindowStart(
      { last_checked_at: hoursBefore(now, 24 * 60), created_at: hoursBefore(now, 24 * 90) },
      now,
    );
    expect(start.toISOString()).toBe(hoursBefore(now, 24 * 14));
  });
});
