// IVT-041 (IV-REQ-011, IV-REQ-021, D17): the open slots for a panel. Pure and
// client-safe: no I/O, every zone handled through Intl.

import {
  BUFFER_MINUTES,
  HORIZON_DAYS,
  MIN_NOTICE_HOURS,
  SLOT_GRID_MINUTES,
  WEEKDAYS,
  type WorkingHours,
} from "./config";
import type { Interval } from "./provider";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export type SlotMember = {
  userId: string;
  timeZone: string;
  workingHours: WorkingHours;
  /** Busy blocks, or null when their calendar couldn't be read ("availability unknown"). */
  busy: Interval[] | null;
};

export type SlotResult = {
  slots: Interval[];
  /** Members whose busy times weren't known, so they weren't checked. */
  unknown: string[];
};

type Range = [number, number];

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(zone: string) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** The wall-clock parts of `instant` in `zone`. */
function wallParts(instant: number, zone: string) {
  const parts = Object.fromEntries(
    partsFormatter(zone)
      .formatToParts(new Date(instant))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  return parts;
}

/** `zone`'s offset from UTC at `instant`, in ms. */
function offsetAt(instant: number, zone: string): number {
  const p = wallParts(instant, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant when the wall clock in `zone` reads year-month-day hour:minute
 * (month 1–12). A time skipped by a DST change lands an hour later.
 */
export function utcOfWallTime(year: number, month: number, day: number, hour: number, minute: number, zone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let instant = guess - offsetAt(guess, zone);
  const second = guess - offsetAt(instant, zone);
  if (second !== instant) instant = second;
  return new Date(instant);
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** A member's working hours over [from, to], as UTC ranges. */
function workingRanges(member: SlotMember, from: number, to: number): Range[] {
  const ranges: Range[] = [];
  const first = wallParts(from - DAY, member.timeZone);
  const days = Math.ceil((to - from) / DAY) + 3;
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(first.year, first.month - 1, first.day + i));
    const weekday = WEEKDAYS[(date.getUTCDay() + 6) % 7];
    const hours = member.workingHours[weekday];
    if (!hours) continue;
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    const startMin = minutesOf(hours.start);
    const endMin = minutesOf(hours.end);
    const start = utcOfWallTime(y, m, d, Math.floor(startMin / 60), startMin % 60, member.timeZone).getTime();
    const end = utcOfWallTime(y, m, d, Math.floor(endMin / 60), endMin % 60, member.timeZone).getTime();
    const s = Math.max(start, from);
    const e = Math.min(end, to);
    if (e > s) ranges.push([s, e]);
  }
  return ranges;
}

function intersect(a: Range[], b: Range[]): Range[] {
  const out: Range[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]);
    const e = Math.min(a[i][1], b[j][1]);
    if (e > s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/**
 * Slots of `durationMinutes` on the 30-minute grid, at least 24 h after `now`
 * and ending within 14 days, inside every member's working hours in their own
 * zone, and at least 10 minutes clear of every known busy block.
 */
export function computeSlots({
  members,
  now,
  durationMinutes,
}: {
  members: SlotMember[];
  now: Date;
  durationMinutes: number;
}): SlotResult {
  const unknown = members.filter((m) => m.busy === null).map((m) => m.userId);
  if (members.length === 0 || durationMinutes <= 0) return { slots: [], unknown };

  const from = now.getTime() + MIN_NOTICE_HOURS * 60 * MIN;
  const to = now.getTime() + HORIZON_DAYS * DAY;
  const length = durationMinutes * MIN;
  const grid = SLOT_GRID_MINUTES * MIN;
  const buffer = BUFFER_MINUTES * MIN;

  let open = workingRanges(members[0], from, to);
  for (const m of members.slice(1)) open = intersect(open, workingRanges(m, from, to));

  const busy = members
    .flatMap((m) => m.busy ?? [])
    .map(({ start, end }): Range => [Date.parse(start) - buffer, Date.parse(end) + buffer])
    .filter(([s, e]) => e > from && s < to)
    .sort((a, b) => a[0] - b[0]);

  const slots: Interval[] = [];
  for (const [rangeStart, rangeEnd] of open) {
    for (let s = Math.ceil(rangeStart / grid) * grid; s + length <= rangeEnd; s += grid) {
      const e = s + length;
      if (busy.some(([bs, be]) => s < be && e > bs)) continue;
      slots.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
    }
  }
  return { slots, unknown };
}
