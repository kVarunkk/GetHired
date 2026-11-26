// Client-safe. The tracker's statuses, labels and board columns (AT-REQ-014,
// AT-REQ-040). The board, the list, the job card button, the agent and MCP
// all read labels from here.

import type { Database } from "@/utils/types/database.types";

export type TrackedStatus = Database["public"]["Enums"]["tracked_application_status"];
export type ApplicationStatus = Database["public"]["Enums"]["application_status"];

export const TRACKED_STATUSES = [
  "saved",
  "applied",
  "in_review",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
  "ghosted",
] as const satisfies readonly TrackedStatus[];

/** Every status but `saved`: what counts as applied. */
export const APPLIED_STATUSES = [
  "applied",
  "in_review",
  "interviewing",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
  "ghosted",
] as const satisfies readonly Exclude<TrackedStatus, "saved">[];
export type AppliedStatus = (typeof APPLIED_STATUSES)[number];

const LABELS: Record<TrackedStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  in_review: "In review",
  interviewing: "Interviewing",
  offer: "Offer",
  accepted: "Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  ghosted: "Ghosted",
};

export const trackedStatusLabel = (status: TrackedStatus): string => LABELS[status];

export const isTrackedStatus = (value: unknown): value is TrackedStatus =>
  typeof value === "string" && (TRACKED_STATUSES as readonly string[]).includes(value);

export const BOARD_COLUMNS = ["applied", "in_review", "interviewing", "offer", "closed"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

const COLUMN_LABELS: Record<BoardColumn, string> = {
  applied: "Applied",
  in_review: "In review",
  interviewing: "Interviewing",
  offer: "Offer",
  closed: "Closed",
};
export const boardColumnLabel = (column: BoardColumn) => COLUMN_LABELS[column];

/** The outcomes a card dropped on Closed can take, in menu order. */
export const CLOSED_OUTCOMES = ["accepted", "rejected", "withdrawn", "ghosted"] as const satisfies readonly AppliedStatus[];
export type ClosedOutcome = (typeof CLOSED_OUTCOMES)[number];

/** The board column of a tracked status; `null` for `saved`, which isn't on the board. */
export function columnOf(status: TrackedStatus): BoardColumn | null {
  if (status === "saved") return null;
  if ((CLOSED_OUTCOMES as readonly string[]).includes(status)) return "closed";
  return status as Exclude<BoardColumn, "closed">;
}

/** The status a card dropped on a column takes. Closed has no default: it asks (AT-REQ-015). */
export function firstStatusOf(column: BoardColumn): AppliedStatus | null {
  return column === "closed" ? null : column;
}

export const isClosedStatus = (status: TrackedStatus) => columnOf(status) === "closed";

/** What decides a GetHired card's column: only what the applicant already sees (AT-REQ-021). */
export type GetHiredInterviews = { screening: boolean; scheduled: boolean };

export type GetHiredPlacement = { column: BoardColumn; onHold: boolean };

/**
 * The column of a GetHired application, from its candidate-facing status and
 * whether it has a screening or scheduled interview (AT-REQ-014). Never a
 * stage kind (AT-DEC-004).
 */
export function gethiredColumn(status: ApplicationStatus, interviews: GetHiredInterviews): GetHiredPlacement {
  if (status === "selected") return { column: "offer", onHold: false };
  if (status === "rejected") return { column: "closed", onHold: false };
  if (interviews.screening || interviews.scheduled) return { column: "interviewing", onHold: false };
  if (status === "stand_by") return { column: "in_review", onHold: true };
  if (status === "reviewed") return { column: "in_review", onHold: false };
  return { column: "applied", onHold: false };
}

const GETHIRED_LABELS: Record<ApplicationStatus, string> = {
  submitted: "Applied",
  reviewed: "In review",
  stand_by: "On hold",
  selected: "Offer",
  rejected: "Rejected",
};
export const gethiredStatusLabel = (status: ApplicationStatus) => GETHIRED_LABELS[status];

/** The tracker status an old external `applications` row reads as (spec §7.2). */
export function legacyTrackedStatus(status: ApplicationStatus): AppliedStatus {
  switch (status) {
    case "submitted":
      return "applied";
    case "reviewed":
    case "stand_by":
      return "in_review";
    case "selected":
      return "offer";
    case "rejected":
      return "rejected";
  }
}

/** Days with no reply before the board offers "Mark as ghosted?" (AT-REQ-017). */
export const GHOSTED_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a tracked card should offer "Mark as ghosted?": Applied or In review, unchanged for 30 days. */
export function suggestsGhosted(status: TrackedStatus, statusChangedAt: string, now: Date = new Date()): boolean {
  if (status !== "applied" && status !== "in_review") return false;
  const changed = new Date(statusChangedAt).getTime();
  if (Number.isNaN(changed)) return false;
  return now.getTime() - changed >= GHOSTED_AFTER_DAYS * DAY_MS;
}
