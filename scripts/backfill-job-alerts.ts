/**
 * Turns the saved searches left in `bookmarks` into canonical job alerts
 * (JA-REQ-063 step 4, JAT-071): fills `filters`, `filters_key`, `name`, `url`
 * and `source = 'legacy_bookmark'`, keeps `created_at`, and deletes rows that
 * parse to nothing alertable and the newer rows of a duplicate.
 *
 *   npx tsx --env-file=.env scripts/backfill-job-alerts.ts [--dry-run]
 *
 * Re-runnable: it only reads rows with no `filters_key`. Run it with
 * `--dry-run` first and record the counts in the tasks file. Uses
 * NEXT_PUBLIC_SUPABASE_URL and SERVICE_ROLE_KEY.
 *
 * Locations are canonicalized here from `location_aliases` directly, because
 * `helpers/job-alerts/canonical.ts` is server-only (it reads a Next cache).
 */
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../utils/types/database.types";
import { backfillCounts, planBackfill, type Canonicalize, type LegacyBookmark } from "../helpers/job-alerts/backfill";
import { filtersKey, type AlertFilters } from "../helpers/job-alerts/filters";

const PAGE = 1000;
const CHUNK = 200;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows: LegacyBookmark[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("bookmarks")
      .select("id, user_id, url, created_at")
      .is("filters_key", null)
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) if (row.user_id) rows.push({ ...row, user_id: row.user_id });
    if ((data?.length ?? 0) < PAGE) break;
  }

  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const currencies = new Map<string, string | null>();
  const existingKeys = new Map<string, Set<string>>();
  for (let i = 0; i < userIds.length; i += CHUNK) {
    const ids = userIds.slice(i, i + CHUNK);
    const [{ data: infos, error: infoError }, { data: keys, error: keyError }] = await Promise.all([
      admin.from("user_info").select("user_id, salary_currency").in("user_id", ids),
      admin.from("bookmarks").select("user_id, filters_key").in("user_id", ids).not("filters_key", "is", null),
    ]);
    if (infoError) throw infoError;
    if (keyError) throw keyError;
    for (const info of infos ?? []) currencies.set(info.user_id, info.salary_currency);
    for (const row of keys ?? []) {
      if (!row.user_id || !row.filters_key) continue;
      const set = existingKeys.get(row.user_id) ?? new Set<string>();
      set.add(row.filters_key);
      existingKeys.set(row.user_id, set);
    }
  }

  const { data: aliasRows, error: aliasError } = await admin.from("location_aliases").select("alias, canonical_name");
  if (aliasError) throw aliasError;
  const canonicalOf = new Map<string, string>();
  for (const { alias, canonical_name } of aliasRows ?? []) {
    canonicalOf.set(alias.trim().toLowerCase(), canonical_name);
    canonicalOf.set(canonical_name.trim().toLowerCase(), canonical_name);
  }

  const canonicalize: Canonicalize = async (filters) => {
    const next: AlertFilters = { ...filters };
    if (filters.location?.length) {
      const location = [
        ...new Set(filters.location.map((name) => (canonicalOf.get(name.trim().toLowerCase()) ?? name).trim().toLowerCase())),
      ]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "en"));
      if (location.length > 0) next.location = location;
      else delete next.location;
    }
    return { filters: next, key: filtersKey(next) };
  };

  const plan = await planBackfill(rows, canonicalize, { existingKeys, currencies });
  console.log(`${dryRun ? "[dry run] " : ""}job alerts backfill: ${JSON.stringify(backfillCounts(rows.length, plan))}`);
  if (dryRun) return;

  for (const update of plan.updates) {
    const { error } = await admin
      .from("bookmarks")
      .update({
        filters: update.filters as unknown as Json,
        filters_key: update.filters_key,
        name: update.name,
        url: update.url,
        source: update.source,
      })
      .eq("id", update.id)
      .is("filters_key", null);
    if (error) throw error;
  }
  for (let i = 0; i < plan.deletes.length; i += CHUNK) {
    const ids = plan.deletes.slice(i, i + CHUNK).map((d) => d.id);
    const { error } = await admin.from("bookmarks").delete().in("id", ids).is("filters_key", null);
    if (error) throw error;
  }
  console.log("done");
}

main().catch((error) => {
  console.error("backfill-job-alerts failed:", error);
  process.exitCode = 1;
});
