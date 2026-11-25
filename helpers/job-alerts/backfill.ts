import { alertFiltersFromSearchParams, alertJobsPath, type AlertFilters } from "./filters";
import { alertName } from "./name";

/** One legacy bookmark, as the backfill reads it. */
export type LegacyBookmark = {
  id: string;
  user_id: string;
  url: string | null;
  created_at: string;
};

export type BackfillUpdate = {
  id: string;
  filters: AlertFilters;
  filters_key: string;
  name: string;
  url: string;
  source: "legacy_bookmark";
};

export type BackfillPlan = {
  updates: BackfillUpdate[];
  /** Rows that parse to nothing alertable, and the newer rows of a collision. */
  deletes: { id: string; why: "not_alertable" | "duplicate" }[];
};

export type Canonicalize = (filters: AlertFilters) => Promise<{ filters: AlertFilters; key: string }>;

/** The tab param of a stored url: only the plain feed can be an alert. */
function tabOf(url: string): string | null {
  return new URLSearchParams(url.replace(/^[^?]*\?/, "")).get("tab");
}

/**
 * JA-REQ-063 step 4, the planning half: what to write and what to delete for
 * every bookmark that has no `filters_key` yet (JAT-071). Pure apart from
 * `canonicalize`, so the I/O around it stays small.
 *
 * - `existingKeys`: `user_id` to the keys the user already has (rows made by the new flow).
 * - `currencies`: `user_id` to the profile salary currency, for a salary filter that has none.
 * - A collision keeps the oldest row (ties by id); the rest are deleted.
 */
export async function planBackfill(
  rows: LegacyBookmark[],
  canonicalize: Canonicalize,
  {
    existingKeys = new Map(),
    currencies = new Map(),
  }: {
    existingKeys?: Map<string, Set<string>>;
    currencies?: Map<string, string | null>;
  } = {},
): Promise<BackfillPlan> {
  const plan: BackfillPlan = { updates: [], deletes: [] };
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const taken = new Map<string, Set<string>>();

  for (const row of sorted) {
    const url = row.url ?? "";
    const tab = tabOf(url);
    let filters = !url || (tab && tab !== "all") ? null : alertFiltersFromSearchParams(url);

    if (filters && filters.minSalary !== undefined && !filters.salaryCurrency) {
      const currency = currencies.get(row.user_id);
      if (currency) {
        filters = { ...filters, salaryCurrency: currency };
      } else {
        // No currency to read the amount in: the rest of the search still stands.
        const rest = { ...filters };
        delete rest.minSalary;
        filters = Object.keys(rest).length > 0 ? rest : null;
      }
    }
    if (!filters) {
      plan.deletes.push({ id: row.id, why: "not_alertable" });
      continue;
    }

    const { filters: canonical, key } = await canonicalize(filters);
    const seen = taken.get(row.user_id) ?? new Set(existingKeys.get(row.user_id) ?? []);
    taken.set(row.user_id, seen);
    if (seen.has(key)) {
      plan.deletes.push({ id: row.id, why: "duplicate" });
      continue;
    }
    seen.add(key);
    plan.updates.push({
      id: row.id,
      filters: canonical,
      filters_key: key,
      name: alertName(canonical),
      url: alertJobsPath(canonical),
      source: "legacy_bookmark",
    });
  }
  return plan;
}

export function backfillCounts(rows: number, plan: BackfillPlan) {
  return {
    rows,
    update: plan.updates.length,
    deleteNotAlertable: plan.deletes.filter((d) => d.why === "not_alertable").length,
    deleteDuplicate: plan.deletes.filter((d) => d.why === "duplicate").length,
  };
}
