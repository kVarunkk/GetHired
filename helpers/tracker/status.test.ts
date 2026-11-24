import { describe, expect, it } from "vitest";
import { Constants } from "@/utils/types/database.types";
import {
  APPLIED_STATUSES,
  BOARD_COLUMNS,
  CLOSED_OUTCOMES,
  TRACKED_STATUSES,
  columnOf,
  firstStatusOf,
  gethiredColumn,
  legacyTrackedStatus,
  suggestsGhosted,
  trackedStatusLabel,
} from "./status";

describe("tracked statuses", () => {
  it("matches the DB enum", () => {
    expect([...TRACKED_STATUSES]).toEqual([...Constants.public.Enums.tracked_application_status]);
  });

  it("gives every status a label and every applied status a column", () => {
    for (const status of TRACKED_STATUSES) expect(trackedStatusLabel(status)).toMatch(/^[A-Z]/);
    for (const status of APPLIED_STATUSES) expect(BOARD_COLUMNS).toContain(columnOf(status));
  });

  it("keeps saved off the board and out of the applied statuses", () => {
    expect(columnOf("saved")).toBeNull();
    expect(APPLIED_STATUSES).not.toContain("saved");
  });

  it("maps each column's first status back to the column; Closed asks instead", () => {
    for (const column of BOARD_COLUMNS) {
      const first = firstStatusOf(column);
      if (column === "closed") expect(first).toBeNull();
      else expect(columnOf(first!)).toBe(column);
    }
    for (const outcome of CLOSED_OUTCOMES) expect(columnOf(outcome)).toBe("closed");
  });
});

describe("gethiredColumn", () => {
  const none = { screening: false, scheduled: false };
  it.each([
    ["submitted", none, "applied", false],
    ["reviewed", none, "in_review", false],
    ["stand_by", none, "in_review", true],
    ["selected", none, "offer", false],
    ["rejected", none, "closed", false],
    ["submitted", { screening: true, scheduled: false }, "interviewing", false],
    ["reviewed", { screening: false, scheduled: true }, "interviewing", false],
    ["stand_by", { screening: true, scheduled: false }, "interviewing", false],
    ["selected", { screening: true, scheduled: true }, "offer", false],
    ["rejected", { screening: true, scheduled: true }, "closed", false],
  ] as const)("%s with %o → %s", (status, interviews, column, onHold) => {
    expect(gethiredColumn(status, interviews)).toEqual({ column, onHold });
  });
});

describe("legacyTrackedStatus (spec §7.2)", () => {
  it.each([
    ["submitted", "applied"],
    ["reviewed", "in_review"],
    ["stand_by", "in_review"],
    ["selected", "offer"],
    ["rejected", "rejected"],
  ] as const)("%s → %s", (from, to) => {
    expect(legacyTrackedStatus(from)).toBe(to);
  });
});

describe("suggestsGhosted", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it("offers it after 30 days in Applied or In review", () => {
    expect(suggestsGhosted("applied", daysAgo(30), now)).toBe(true);
    expect(suggestsGhosted("in_review", daysAgo(45), now)).toBe(true);
  });

  it("not at 29 days, and never for other statuses", () => {
    expect(suggestsGhosted("applied", daysAgo(29), now)).toBe(false);
    for (const status of ["saved", "interviewing", "offer", "accepted", "rejected", "withdrawn", "ghosted"] as const) {
      expect(suggestsGhosted(status, daysAgo(90), now)).toBe(false);
    }
  });
});
