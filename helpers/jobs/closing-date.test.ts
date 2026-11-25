import { describe, expect, it } from "vitest";
import { endOfDayIn, todayIn } from "@/helpers/companies/time-zone";
import { CLOSES_AT_FILLED, CLOSES_AT_PAST, closingDateError, closingDateSchema, formatClosingDate } from "./closing-date";

// 2026-11-24 23:30 UTC: already the 25th east of UTC+0:30, still the 24th in UTC−8.
const LATE_UTC = new Date("2026-11-24T23:30:00Z");
// 2026-11-24 10:30 UTC: already the 25th in UTC+13, still the 24th in UTC−8.
const MORNING_UTC = new Date("2026-11-24T10:30:00Z");

describe("todayIn (JL-REQ-014)", () => {
  it.each([
    ["America/Los_Angeles", LATE_UTC, "2026-11-24"],
    ["Asia/Kolkata", LATE_UTC, "2026-11-25"],
    ["Pacific/Auckland", MORNING_UTC, "2026-11-24"],
    ["Pacific/Tongatapu", MORNING_UTC, "2026-11-24"],
    ["Pacific/Kiritimati", MORNING_UTC, "2026-11-25"],
    ["UTC", LATE_UTC, "2026-11-24"],
  ])("in %s at %s is %s", (zone, now, today) => {
    expect(todayIn(zone, now)).toBe(today);
  });

  it("falls back to UTC for an unset or unknown zone", () => {
    expect(todayIn(null, LATE_UTC)).toBe("2026-11-24");
    expect(todayIn("Mars/Olympus", LATE_UTC)).toBe("2026-11-24");
  });
});

describe("closingDateError (JL-REQ-014)", () => {
  it.each([
    // UTC−8 at 15:30 on the 24th: the 24th is today.
    ["America/Los_Angeles", "2026-11-24", null],
    ["America/Los_Angeles", "2026-11-23", CLOSES_AT_PAST],
    // UTC+5:30 at 05:00 on the 25th: the 24th is past.
    ["Asia/Kolkata", "2026-11-24", CLOSES_AT_PAST],
    ["Asia/Kolkata", "2026-11-25", null],
    // UTC+14 at 13:30 on the 25th.
    ["Pacific/Kiritimati", "2026-11-24", CLOSES_AT_PAST],
  ])("in %s, %s → %s", (timeZone, next, error) => {
    expect(closingDateError({ next, timeZone, now: LATE_UTC })).toBe(error);
  });

  it("checks UTC+13 around its midnight", () => {
    // 10:59 UTC on the 24th is 23:59 on the 24th in Pacific/Tongatapu (UTC+13).
    const beforeMidnight = new Date("2026-11-24T10:59:00Z");
    const afterMidnight = new Date("2026-11-24T11:01:00Z");
    expect(closingDateError({ next: "2026-11-24", timeZone: "Pacific/Tongatapu", now: beforeMidnight })).toBeNull();
    expect(closingDateError({ next: "2026-11-24", timeZone: "Pacific/Tongatapu", now: afterMidnight })).toBe(
      CLOSES_AT_PAST,
    );
  });

  it("always allows clearing, leaving unchanged and keeping the saved date", () => {
    expect(closingDateError({ next: null, state: "filled", timeZone: "UTC", now: LATE_UTC })).toBeNull();
    expect(closingDateError({ next: undefined, state: "filled", timeZone: "UTC", now: LATE_UTC })).toBeNull();
    expect(
      closingDateError({ next: "2026-01-01", previous: "2026-01-01", state: "closed", timeZone: "UTC", now: LATE_UTC }),
    ).toBeNull();
  });

  it("refuses a new date on a filled job", () => {
    expect(closingDateError({ next: "2027-01-01", state: "filled", timeZone: "UTC", now: LATE_UTC })).toBe(
      CLOSES_AT_FILLED,
    );
  });

  it.each(["draft", "pending_approval", "open", "paused", "closed"] as const)("allows a new date on a %s job", (state) => {
    expect(closingDateError({ next: "2027-01-01", state, timeZone: "UTC", now: LATE_UTC })).toBeNull();
  });
});

describe("closingDateSchema", () => {
  it.each([
    ["2026-12-31", true],
    ["2026-02-30", false],
    ["31/12/2026", false],
    ["2026-12-31T00:00:00Z", false],
  ])("%s valid: %s", (value, ok) => {
    expect(closingDateSchema.safeParse(value).success).toBe(ok);
  });
});

describe("endOfDayIn (JL-REQ-016)", () => {
  it.each([
    ["UTC", "2026-12-31T23:59:59.000Z"],
    [null, "2026-12-31T23:59:59.000Z"],
    ["Asia/Kolkata", "2026-12-31T18:29:59.000Z"],
    ["America/Los_Angeles", "2027-01-01T07:59:59.000Z"],
    ["Pacific/Tongatapu", "2026-12-31T10:59:59.000Z"],
  ])("2026-12-31 in %s ends at %s", (zone, instant) => {
    expect(endOfDayIn("2026-12-31", zone)).toBe(instant);
  });

  it("follows daylight saving time", () => {
    // New York: EDT (UTC−4) in July, EST (UTC−5) in January.
    expect(endOfDayIn("2026-07-01", "America/New_York")).toBe("2026-07-02T03:59:59.000Z");
    expect(endOfDayIn("2026-01-01", "America/New_York")).toBe("2026-01-02T04:59:59.000Z");
  });

  it("is null for a malformed date", () => {
    expect(endOfDayIn("31/12/2026", "UTC")).toBeNull();
  });
});

describe("formatClosingDate", () => {
  it("reads the date as written, whatever the server's zone", () => {
    expect(formatClosingDate("2026-12-31")).toBe("December 31, 2026");
  });
});
