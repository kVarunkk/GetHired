// Client-safe (IVT-024, D21): the company's IANA time zone. The DB checks the
// zone against pg_timezone_names; this catches typos before the round trip.

/** Whether the runtime knows `zone` as an IANA time zone. */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's zone, or null when it can't tell. */
export function browserTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** Every zone the runtime knows, for the settings picker. */
export function timeZoneOptions(current?: string | null): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf?.("timeZone") ?? [];
  const all = zones.includes("UTC") ? zones : ["UTC", ...zones];
  return current && !all.includes(current) ? [current, ...all] : all;
}

/**
 * Today's date (`YYYY-MM-DD`) in `zone`, or in UTC when the zone is unset or
 * unknown, as `company_today()` reads it in SQL (JL-REQ-014).
 */
export function todayIn(zone: string | null | undefined, now: Date = new Date()): string {
  const timeZone = zone && isValidTimeZone(zone) ? zone : "UTC";
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** `zone`'s offset from UTC at `at`, in minutes (east positive). */
function offsetMinutes(zone: string, at: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at) / 60_000);
}

/**
 * The last second of `date` (`YYYY-MM-DD`) in `zone` (UTC when unset), as an
 * ISO instant: when a job with that closing date stops taking applications
 * (JL-REQ-016). Null for a malformed date.
 */
export function endOfDayIn(date: string, zone: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const timeZone = zone && isValidTimeZone(zone) ? zone : "UTC";
  const wall = Date.UTC(+match[1], +match[2] - 1, +match[3], 23, 59, 59);
  if (Number.isNaN(wall)) return null;
  // Twice, so a DST change between the guess and the answer is accounted for.
  let instant = wall - offsetMinutes(timeZone, wall) * 60_000;
  instant = wall - offsetMinutes(timeZone, instant) * 60_000;
  return new Date(instant).toISOString();
}
