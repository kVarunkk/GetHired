// Client-safe view rules for the application's Interviews section (IVT-020).
// The RPCs enforce the same rules (IV-REQ-024); these only decide what to show.

import { KIT_GRACE_DAYS, NO_SHOW_WINDOW_DAYS } from "@/helpers/interviews/config";
import type { InterviewStatus } from "@/helpers/interviews/interviews";

export const STATUS_LABELS: Record<InterviewStatus, string> = {
  awaiting_candidate: "Awaiting candidate",
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const STATUS_TONE: Record<InterviewStatus, string> = {
  awaiting_candidate: "border-warning/40 bg-warning/10",
  scheduled: "border-brand/30 text-brand",
  completed: "border-success/30 bg-success/10 text-success",
  cancelled: "text-muted-foreground",
  no_show: "text-muted-foreground",
};

type Timed = { status: InterviewStatus; startsAt: string | null; endsAt: string | null };

const DAY = 86_400_000;

/** Reschedule and change the panel: before it's over. */
export const canChange = (i: Timed) => i.status === "scheduled" || i.status === "awaiting_candidate";

export const canCancel = canChange;

/** `completed` from `scheduled`, once it has started. */
export const canMarkCompleted = (i: Timed, now: number) =>
  i.status === "scheduled" && !!i.startsAt && Date.parse(i.startsAt) <= now;

/** `no_show` after the start, or up to 7 days after a completed one's end. */
export function canMarkNoShow(i: Timed, now: number): boolean {
  if (i.status === "scheduled") return !!i.startsAt && Date.parse(i.startsAt) <= now;
  if (i.status === "completed") return !!i.endsAt && Date.parse(i.endsAt) >= now - NO_SHOW_WINDOW_DAYS * DAY;
  return false;
}

/**
 * IVT-084: "Remind interviewers" while someone on the panel still owes a
 * scorecard and can write one: from the start of a scheduled interview, and
 * until the kit closes 7 days after a completed one. The RPC also skips
 * anyone reminded in the last 24 hours.
 */
export function canRemind(i: Timed & { panel: { scorecardStatus: string }[] }, now: number): boolean {
  const open =
    i.status === "scheduled"
      ? !!i.startsAt && Date.parse(i.startsAt) <= now
      : i.status === "completed" && !!i.endsAt && Date.parse(i.endsAt) > now - KIT_GRACE_DAYS * DAY;
  return open && i.panel.some((p) => p.scorecardStatus !== "submitted");
}

const names = (list: { name: string }[]) =>
  list.length <= 2
    ? list.map((m) => m.name).join(" and ")
    : `${list.slice(0, -1).map((m) => m.name).join(", ")} and ${list.at(-1)!.name}`;

/** The toast after "Remind interviewers": who was emailed, and who wasn't and why. */
export function reminderToast(result: {
  reminded: { name: string }[];
  skipped: { name: string; reason: "submitted" | "recent" | "failed" }[];
}): { ok: boolean; message: string } {
  const recent = result.skipped.filter((s) => s.reason === "recent");
  const failed = result.skipped.filter((s) => s.reason === "failed");
  const parts = [
    result.reminded.length > 0 ? `Reminded ${names(result.reminded)}.` : "Nobody was emailed.",
    recent.length > 0 ? `${names(recent)} ${recent.length === 1 ? "was" : "were"} reminded in the last 24 hours.` : "",
    failed.length > 0 ? `The email to ${names(failed)} didn't go out. Try again later.` : "",
  ].filter(Boolean);
  return { ok: result.reminded.length > 0, message: parts.join(" ") };
}

/** "2 of 3 submitted". */
export const feedbackCount = (submitted: number, total: number) => `${submitted} of ${total} submitted`;

/** A `datetime-local` value (the browser's zone) as an ISO instant, or null. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** An ISO instant as a `datetime-local` value in the browser's zone. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type CalendarBannerKind = "reconnect" | "organizer_disconnected";

/**
 * IVT-048 (IV-REQ-023b): an open interview on a Google Calendar whose
 * organizer's calendar isn't connected any more. The organizer is asked to
 * reconnect; anyone else, to reschedule it onto their own calendar.
 * `statuses` is `panel_calendar_status` by user id.
 */
export function calendarBanner(
  i: Timed & { organizerUserId: string | null; onCalendar: boolean },
  currentUserId: string,
  statuses: Record<string, "connected" | "unknown" | "error">,
): CalendarBannerKind | null {
  if (!i.onCalendar || !i.organizerUserId || !canChange(i)) return null;
  if (statuses[i.organizerUserId] === "connected") return null;
  return i.organizerUserId === currentUserId ? "reconnect" : "organizer_disconnected";
}
