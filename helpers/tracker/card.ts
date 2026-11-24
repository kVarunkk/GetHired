// Client-safe. What a My Jobs card shows besides its title (AT-REQ-016).

import { jobUrlDomain } from "./job-url";
import type { TrackerItem } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today as yyyy-mm-dd in the viewer's time zone. */
export function todayIso(now: Date = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Whole days from an ISO date to today (0 on the day itself, never negative). */
export function daysSince(isoDate: string, now: Date = new Date()): number {
  const from = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${todayIso(now)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

/** "Applied today", "Applied 1 day ago", "Applied 12 days ago". */
export function appliedAgo(isoDate: string, now: Date = new Date()): string {
  const days = daysSince(isoDate, now);
  if (days === 0) return "Applied today";
  return `Applied ${days} day${days === 1 ? "" : "s"} ago`;
}

/** A follow-up date on or before today. */
export const isFollowUpDue = (date: string | null, now: Date = new Date()) => Boolean(date && date <= todayIso(now));

/** "GetHired" for a GetHired application, else the posting's domain. */
export const sourceMark = (item: Pick<TrackerItem, "kind" | "jobUrl">) =>
  item.kind === "gethired" ? "GetHired" : jobUrlDomain(item.jobUrl);

/** "Nov 24" or "Nov 24, 2025" for another year. */
export function shortDate(isoDate: string, now: Date = new Date()): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  const sameYear = date.getUTCFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** The newest `limit` cards by applied date, for the dashboard (AT-REQ-024). */
export function newestApplications<T extends { appliedAt: string; updatedAt: string }>(items: T[], limit = 3): T[] {
  return [...items]
    .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
