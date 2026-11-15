// Calendar scheduling rules (spec D17, §4). Fixed in v1: no company setting.
// Client-safe.

/** Slots start at least this far ahead. */
export const MIN_NOTICE_HOURS = 24;

/** Slots end at most this many days out. */
export const HORIZON_DAYS = 14;

/** Free time kept on both sides of a panel member's busy block. */
export const BUFFER_MINUTES = 10;

/** Slots start on this grid. */
export const SLOT_GRID_MINUTES = 30;

/** Settings → My calendar (IVT-037). */
export const MY_CALENDAR_PATH = "/company/settings/my-calendar";

/** Starts the Google connect flow, coming back to `returnTo` (an in-app path). */
export const connectCalendarHref = (returnTo: string) =>
  `/api/calendar/google/connect?returnTo=${encodeURIComponent(returnTo)}`;

/** A self-scheduling link works this long (IV-SEC-003). */
export const LINK_VALID_DAYS = 7;

/** The candidate can reschedule or cancel until this long before the start (IV-REQ-022). */
export const CANDIDATE_CHANGE_CUTOFF_HOURS = 4;

/** The public page's computed slots are cached this long (§5). */
export const SLOTS_CACHE_SECONDS = 120;

/**
 * POST /api/schedule/[token] requests per window, per link and per IP
 * (IVT-063). The page's own buttons need a handful; the limits stop a script
 * from walking the slots or hammering Google through one link.
 */
export const LINK_TOKEN_LIMIT = 10;
export const LINK_IP_LIMIT = 30;
export const LINK_LIMIT_WINDOW_SECONDS = 600;

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** One day's working hours, as "HH:MM" in the member's own time zone. */
export type DayHours = { start: string; end: string };

/** Per weekday; a missing day is a day off. */
export type WorkingHours = Partial<Record<Weekday, DayHours>>;

/** IV-REQ-011: Mon–Fri 10:00–18:00. */
export const DEFAULT_WORKING_HOURS: WorkingHours = {
  mon: { start: "10:00", end: "18:00" },
  tue: { start: "10:00", end: "18:00" },
  wed: { start: "10:00", end: "18:00" },
  thu: { start: "10:00", end: "18:00" },
  fri: { start: "10:00", end: "18:00" },
};
