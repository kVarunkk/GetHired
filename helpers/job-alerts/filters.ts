import { jobFilterSchema } from "@/helpers/jobs/filterSchema";

/**
 * Job alert filters (JA-REQ-002). Client-safe: the banner, the bell and the
 * server all read a search the same way. Locations are canonicalized on the
 * server only (`canonicalAlertFilters`, helpers/job-alerts/canonical.ts), and
 * `filters_key` is computed there from the canonical filters.
 */

/** Where an alert was created. Mirrors the `bookmarks_source_check` constraint. */
export const JOB_ALERT_SOURCES = [
  "feed_banner",
  "empty_state",
  "settings",
  "agent",
  "mcp",
  "legacy_bookmark",
] as const;
export type JobAlertSource = (typeof JOB_ALERT_SOURCES)[number];

export const JOB_ALERT_FREQUENCIES = ["daily", "weekly"] as const;
export type JobAlertFrequency = (typeof JOB_ALERT_FREQUENCIES)[number];

export const isJobAlertFrequency = (value: unknown): value is JobAlertFrequency =>
  value === "daily" || value === "weekly";

export type AlertFilters = {
  jobTitleKeywords?: string[];
  location?: string[];
  jobType?: string[];
  platform?: string[];
  companyName?: string[];
  minSalary?: number;
  salaryCurrency?: string;
  minExperience?: number;
  maxExperience?: number;
};

const ARRAY_KEYS = ["jobTitleKeywords", "location", "jobType", "platform", "companyName"] as const;
const NUMBER_KEYS = ["minSalary", "minExperience", "maxExperience"] as const;

/** The alertable keys, in the order the URL and the key are written. */
export const ALERT_FILTER_KEYS = [
  "jobTitleKeywords",
  "location",
  "jobType",
  "platform",
  "companyName",
  "minSalary",
  "salaryCurrency",
  "minExperience",
  "maxExperience",
] as const satisfies readonly (keyof AlertFilters)[];

/** Free text compared case-insensitively. Keywords and locations are stored lower-case. */
const LOWER_CASED: readonly string[] = ["jobTitleKeywords", "location"];

type SearchInput = URLSearchParams | string | Record<string, string | string[] | undefined>;

function readParam(input: SearchInput, key: string): string | undefined {
  if (typeof input === "string" || input instanceof URLSearchParams) {
    const params = typeof input === "string" ? new URLSearchParams(input.replace(/^[^?]*\?/, "")) : input;
    return params.get(key) ?? undefined;
  }
  const value = input[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Trimmed, de-duplicated (case-insensitively) and sorted. */
function cleanList(values: string[], lowerCase: boolean): string[] {
  const seen = new Map<string, string>();
  for (const raw of values) {
    const trimmed = raw.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const value = lowerCase ? trimmed.toLowerCase() : trimmed;
    const k = value.toLowerCase();
    if (!seen.has(k)) seen.set(k, value);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "en"));
}

/**
 * The alertable part of a job search: role keywords, locations, job types,
 * platforms, companies, minimum salary and currency, and the experience range.
 * Sorting, the date window, tabs, application status, similar-job ids, paging
 * and anything unknown are dropped, so a relevance-sorted search keeps its
 * filters (JA-DEC-004). Each value is checked with `jobFilterSchema` on its
 * own, so one bad value drops only itself. Null when nothing alertable is left.
 */
export function alertFiltersFromSearchParams(input: SearchInput): AlertFilters | null {
  const shape = jobFilterSchema.shape;
  const filters: AlertFilters = {};

  for (const key of ARRAY_KEYS) {
    const raw = readParam(input, key);
    if (!raw) continue;
    const parsed = shape[key].safeParse(raw);
    if (!parsed.success || !Array.isArray(parsed.data)) continue;
    const list = cleanList(parsed.data as string[], LOWER_CASED.includes(key));
    if (list.length > 0) filters[key] = list;
  }

  for (const key of NUMBER_KEYS) {
    const raw = readParam(input, key);
    if (raw === undefined || raw.trim() === "") continue;
    const parsed = shape[key].safeParse(raw);
    if (!parsed.success || typeof parsed.data !== "number" || !Number.isFinite(parsed.data)) continue;
    const value = Math.floor(parsed.data);
    // A minimum salary of 0 filters nothing.
    if (key === "minSalary" && value <= 0) continue;
    filters[key] = value;
  }

  const currency = shape.salaryCurrency.safeParse(readParam(input, "salaryCurrency"));
  if (currency.success && currency.data) filters.salaryCurrency = currency.data;

  if (
    filters.minExperience !== undefined &&
    filters.maxExperience !== undefined &&
    filters.minExperience > filters.maxExperience
  ) {
    [filters.minExperience, filters.maxExperience] = [filters.maxExperience, filters.minExperience];
  }

  return Object.keys(filters).length > 0 ? filters : null;
}

/** A query string for the alert: newest first, no sort or date params. */
export function alertSearchString(filters: AlertFilters): string {
  const params = new URLSearchParams();
  for (const key of ALERT_FILTER_KEYS) {
    const value = filters[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join("|"));
    } else {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

/** The in-app jobs page for an alert, stored in `bookmarks.url`. */
export const alertJobsPath = (filters: AlertFilters) => `/jobs?${alertSearchString(filters)}`;

/**
 * A stable string for "is there already an alert for this search?" (the
 * unique `(user_id, filters_key)` index). Fixed key order, sorted arrays and
 * case-insensitive text. Call it on canonical filters (`canonicalAlertFilters`)
 * so location spellings agree.
 */
export function filtersKey(filters: AlertFilters): string {
  const normalized: Record<string, unknown> = {};
  for (const key of ALERT_FILTER_KEYS) {
    const value = filters[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      normalized[key] = [...new Set(value.map((v) => v.trim().toLowerCase()))].sort();
    } else {
      normalized[key] = value;
    }
  }
  return JSON.stringify(normalized);
}

/** The filter names a search uses, for analytics (never the values). */
export const alertFilterKeys = (filters: AlertFilters): string[] =>
  ALERT_FILTER_KEYS.filter((key) => filters[key] !== undefined);
