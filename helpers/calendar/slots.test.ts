import { describe, expect, it } from "vitest";
import { DEFAULT_WORKING_HOURS, HORIZON_DAYS, MIN_NOTICE_HOURS, type WorkingHours } from "./config";
import { computeSlots, utcOfWallTime, type SlotMember } from "./slots";

const HOUR = 3_600_000;
const MIN = 60_000;

const member = (overrides: Partial<SlotMember> = {}): SlotMember => ({
  userId: "u1",
  timeZone: "UTC",
  workingHours: DEFAULT_WORKING_HOURS,
  busy: [],
  ...overrides,
});

const starts = (slots: { start: string }[]) => slots.map((s) => s.start);
const onDay = (slots: { start: string }[], day: string) => starts(slots).filter((s) => s.startsWith(day));

// Monday 2026-11-16 08:00 UTC.
const now = new Date("2026-11-16T08:00:00.000Z");

describe("computeSlots (IVT-041, IV-REQ-011, IV-REQ-021, D17)", () => {
  it("puts every slot on the 30-minute grid", () => {
    const { slots } = computeSlots({ members: [member()], now, durationMinutes: 45 });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(Date.parse(s.start) % (30 * MIN)).toBe(0);
      expect(Date.parse(s.end) - Date.parse(s.start)).toBe(45 * MIN);
    }
  });

  it("starts at least 24 hours ahead and ends within 14 days", () => {
    const { slots } = computeSlots({ members: [member()], now, durationMinutes: 45 });
    expect(Date.parse(slots[0].start)).toBeGreaterThanOrEqual(now.getTime() + MIN_NOTICE_HOURS * HOUR);
    expect(Date.parse(slots.at(-1)!.end)).toBeLessThanOrEqual(now.getTime() + HORIZON_DAYS * 24 * HOUR);
    // Tuesday 08:00 is 24 h out, but the day starts at 10:00.
    expect(slots[0].start).toBe("2026-11-17T10:00:00.000Z");
  });

  it("keeps working hours: Mon–Fri 10:00–18:00, the slot ending by 18:00", () => {
    const { slots } = computeSlots({ members: [member()], now, durationMinutes: 45 });
    const tuesday = onDay(slots, "2026-11-17");
    expect(tuesday[0]).toBe("2026-11-17T10:00:00.000Z");
    expect(tuesday.at(-1)).toBe("2026-11-17T17:00:00.000Z");
    expect(onDay(slots, "2026-11-21")).toEqual([]); // Saturday
    expect(onDay(slots, "2026-11-22")).toEqual([]); // Sunday
  });

  it("keeps a 10-minute buffer on both sides of a busy block", () => {
    const busy = [{ start: "2026-11-17T12:00:00.000Z", end: "2026-11-17T13:00:00.000Z" }];
    const { slots } = computeSlots({ members: [member({ busy })], now, durationMinutes: 45 });
    const tuesday = onDay(slots, "2026-11-17");
    expect(tuesday).toContain("2026-11-17T11:00:00.000Z"); // ends 11:45, 15 min before
    expect(tuesday).not.toContain("2026-11-17T11:30:00.000Z"); // ends 12:15
    expect(tuesday).not.toContain("2026-11-17T13:00:00.000Z"); // starts right at the end
    expect(tuesday).toContain("2026-11-17T13:30:00.000Z");

    const tight = computeSlots({
      members: [member({ busy: [{ start: "2026-11-17T11:40:00.000Z", end: "2026-11-17T11:45:00.000Z" }] })],
      now,
      durationMinutes: 30,
    });
    // 11:00–11:30 ends 10 min before the block: allowed. 12:00 starts 15 min after: allowed.
    expect(onDay(tight.slots, "2026-11-17")).toEqual(expect.arrayContaining(["2026-11-17T11:00:00.000Z", "2026-11-17T12:00:00.000Z"]));
    expect(onDay(tight.slots, "2026-11-17")).not.toContain("2026-11-17T11:30:00.000Z");
  });

  it("merges busy blocks and working hours across the whole panel, each in their own zone", () => {
    const london = member({ userId: "l", timeZone: "Europe/London", workingHours: { tue: { start: "09:00", end: "17:00" } } });
    const newYork = member({ userId: "n", timeZone: "America/New_York", workingHours: { tue: { start: "09:00", end: "17:00" } } });
    const { slots } = computeSlots({ members: [london, newYork], now, durationMinutes: 45 });
    // Winter: London 09–17 UTC, New York 14–22 UTC; overlap 14:00–17:00.
    expect(onDay(slots, "2026-11-17")).toEqual([
      "2026-11-17T14:00:00.000Z",
      "2026-11-17T14:30:00.000Z",
      "2026-11-17T15:00:00.000Z",
      "2026-11-17T15:30:00.000Z",
      "2026-11-17T16:00:00.000Z",
    ]);

    const busyNy = member({ ...newYork, busy: [{ start: "2026-11-17T15:00:00.000Z", end: "2026-11-17T16:00:00.000Z" }] });
    // New York busy 15:00–16:00 (14:50–16:10 with the buffer); 16:30 would end after London's 17:00.
    expect(onDay(computeSlots({ members: [london, busyNy], now, durationMinutes: 45 }).slots, "2026-11-17")).toEqual([
      "2026-11-17T14:00:00.000Z",
    ]);
  });

  it("follows Europe/London across the end of summer time", () => {
    const hours: WorkingHours = { fri: { start: "10:00", end: "18:00" }, mon: { start: "10:00", end: "18:00" } };
    const { slots } = computeSlots({
      members: [member({ timeZone: "Europe/London", workingHours: hours })],
      now: new Date("2026-10-21T08:00:00.000Z"),
      durationMinutes: 60,
    });
    // Fri 23 Oct is BST (UTC+1); Mon 26 Oct is GMT.
    expect(onDay(slots, "2026-10-23")[0]).toBe("2026-10-23T09:00:00.000Z");
    expect(onDay(slots, "2026-10-23").at(-1)).toBe("2026-10-23T16:00:00.000Z");
    expect(onDay(slots, "2026-10-26")[0]).toBe("2026-10-26T10:00:00.000Z");
    expect(onDay(slots, "2026-10-26").at(-1)).toBe("2026-10-26T17:00:00.000Z");
  });

  it("follows America/New_York across the end of daylight time", () => {
    const hours: WorkingHours = { fri: { start: "10:00", end: "18:00" }, mon: { start: "10:00", end: "18:00" } };
    const { slots } = computeSlots({
      members: [member({ timeZone: "America/New_York", workingHours: hours })],
      now: new Date("2026-10-28T08:00:00.000Z"),
      durationMinutes: 60,
    });
    // Fri 30 Oct is EDT (UTC−4); Mon 2 Nov is EST (UTC−5).
    expect(onDay(slots, "2026-10-30")[0]).toBe("2026-10-30T14:00:00.000Z");
    expect(onDay(slots, "2026-11-02")[0]).toBe("2026-11-02T15:00:00.000Z");
  });

  it("follows the start of summer time too", () => {
    expect(utcOfWallTime(2026, 3, 27, 10, 0, "Europe/London").toISOString()).toBe("2026-03-27T10:00:00.000Z");
    expect(utcOfWallTime(2026, 3, 30, 10, 0, "Europe/London").toISOString()).toBe("2026-03-30T09:00:00.000Z");
    expect(utcOfWallTime(2026, 3, 9, 10, 0, "America/New_York").toISOString()).toBe("2026-03-09T14:00:00.000Z");
    expect(utcOfWallTime(2026, 11, 17, 10, 0, "Asia/Kolkata").toISOString()).toBe("2026-11-17T04:30:00.000Z");
  });

  it("returns nothing when the panel has no common hours", () => {
    const a = member({ userId: "a", workingHours: { mon: { start: "09:00", end: "10:00" } } });
    const b = member({ userId: "b", workingHours: { tue: { start: "09:00", end: "10:00" } } });
    expect(computeSlots({ members: [a, b], now, durationMinutes: 30 }).slots).toEqual([]);
    expect(computeSlots({ members: [member({ workingHours: {} })], now, durationMinutes: 30 }).slots).toEqual([]);
    expect(computeSlots({ members: [], now, durationMinutes: 30 }).slots).toEqual([]);
  });

  it("leaves a member with unknown availability out of the busy times, and flags them", () => {
    const known = member({ userId: "k", busy: [{ start: "2026-11-17T10:00:00.000Z", end: "2026-11-17T18:00:00.000Z" }] });
    const unknown = member({ userId: "x", busy: null });
    const result = computeSlots({ members: [known, unknown], now, durationMinutes: 45 });
    expect(result.unknown).toEqual(["x"]);
    expect(onDay(result.slots, "2026-11-17")).toEqual([]);
    expect(onDay(result.slots, "2026-11-18")[0]).toBe("2026-11-18T10:00:00.000Z");
  });
});
