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
