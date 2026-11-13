// The company Applications list's URL state (QF-REQ-022/024): filters,
// sorting and paging live in the search params. Pure and client-safe.
import { RECOMMENDATION_LABELS, type ScreeningRecommendation } from "@/helpers/matching/config";
import type { Database } from "@/utils/types/database.types";

export const APPLICATIONS_PATH = "/company/applications";
/** QF-REQ-021: rows per page. */
export const APPLICATIONS_PAGE_SIZE = 25;
const Q_MAX_LENGTH = 100;

export type ApplicationStatus = Database["public"]["Enums"]["application_status"];
export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  "submitted",
  "reviewed",
  "selected",
  "stand_by",
  "rejected",
];
const RECOMMENDATIONS = Object.keys(RECOMMENDATION_LABELS) as ScreeningRecommendation[];
export const KNOCKOUT_FILTERS = ["failed", "passed"] as const;
export const APPLICATION_SORTS = ["created_at", "fit_score", "person_name", "status"] as const;

export type ApplicationSort = (typeof APPLICATION_SORTS)[number];
export type SortDir = "asc" | "desc";

export type ApplicationListParams = {
  /** Part of the person's name. Trimmed and capped, not escaped (see `escapeLike`). */
  q: string | null;
  job: string | null;
  status: ApplicationStatus | null;
  recommendation: ScreeningRecommendation | null;
  knockout: (typeof KNOCKOUT_FILTERS)[number] | null;
  sort: ApplicationSort;
  dir: SortDir;
  /** 1-based. */
  page: number;
};

/** Names sort A–Z first; dates and scores highest first. */
export const defaultDir = (sort: ApplicationSort): SortDir =>
  sort === "person_name" || sort === "status" ? "asc" : "desc";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const oneOf = <T extends string>(options: readonly T[], value: string | undefined): T | null =>
  value !== undefined && (options as readonly string[]).includes(value) ? (value as T) : null;

/** Reads the list's state from the page's search params. Unknown values fall back to the defaults. */
export function parseApplicationListParams(params: RawParams): ApplicationListParams {
  const get = (key: string) => first(params[key]);
  const q = get("q")?.trim().slice(0, Q_MAX_LENGTH) || null;
  const job = get("job");
  const sort = oneOf(APPLICATION_SORTS, get("sort")) ?? "created_at";
  const page = /^\d+$/.test(get("page") ?? "") ? Number(get("page")) : 0;
  return {
    q,
    job: job && UUID.test(job) ? job : null,
    status: oneOf(APPLICATION_STATUSES, get("status")),
    recommendation: oneOf(RECOMMENDATIONS, get("recommendation")),
    knockout: oneOf(KNOCKOUT_FILTERS, get("knockout")),
    sort,
    dir: oneOf(["asc", "desc"] as const, get("dir")) ?? defaultDir(sort),
    page: page > 0 ? page : 1,
  };
}

/**
 * `value` as a literal inside an ilike pattern: escapes `\`, `%` and `_`, and
 * drops `*`, which PostgREST reads as `%`.
 */
export function escapeLike(value: string): string {
  return value.replace(/\*/g, "").replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The list's URL with `patch` applied. Any change other than the page goes
 * back to page 1. Empty values and defaults are left out.
 */
export function applicationListHref(
  current: ApplicationListParams,
  patch: Partial<ApplicationListParams>,
): string {
  const next = { ...current, ...patch };
  if (!("page" in patch)) next.page = 1;
  // A new sort without a direction takes that sort's default.
  if ("sort" in patch && !("dir" in patch)) next.dir = defaultDir(next.sort);

  const search = new URLSearchParams();
  for (const key of ["q", "job", "status", "recommendation", "knockout"] as const) {
    if (next[key]) search.set(key, next[key]);
  }
  if (next.sort !== "created_at") search.set("sort", next.sort);
  if (next.dir !== defaultDir(next.sort)) search.set("dir", next.dir);
  if (next.page > 1) search.set("page", String(next.page));

  const query = search.toString();
  return query ? `${APPLICATIONS_PATH}?${query}` : APPLICATIONS_PATH;
}
