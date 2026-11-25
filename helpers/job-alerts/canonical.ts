import "server-only";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { type AlertFilters, filtersKey } from "./filters";

/**
 * Alert filters with each location under its canonical name (lower-case,
 * de-duplicated, sorted), so "bengaluru" and "bangalore" are one alert. The
 * client-safe parse can't do this: the alias index is server-only (tasks,
 * Difference 1).
 */
export async function canonicalAlertFilters(filters: AlertFilters): Promise<AlertFilters> {
  if (!filters.location?.length) return filters;
  const canonical = await canonicalizeLocations(filters.location);
  const location = [...new Set(canonical.map((name) => name.trim().toLowerCase()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const next: AlertFilters = { ...filters };
  if (location.length > 0) next.location = location;
  else delete next.location;
  return next;
}

/** The canonical filters and their `filters_key`. */
export async function canonicalAlert(filters: AlertFilters): Promise<{ filters: AlertFilters; key: string }> {
  const canonical = await canonicalAlertFilters(filters);
  return { filters: canonical, key: filtersKey(canonical) };
}
