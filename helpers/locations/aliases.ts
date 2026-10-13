import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

type AliasRow = { alias: string; canonical_name: string };

/**
 * The whole `location_aliases` table (87 rows), cached for an hour under the
 * `locations` tag, like `/api/locations`. RLS has no policies on the table, so
 * it's read with the service-role client; it holds nothing user-specific.
 */
const loadAliasRows = unstable_cache(
  async (): Promise<AliasRow[]> => {
    const { data, error } = await createServiceRoleClient()
      .from("location_aliases")
      .select("alias, canonical_name");
    if (error) throw error;
    return data ?? [];
  },
  ["location-aliases"],
  { revalidate: 3600, tags: ["locations"] },
);

const key = (name: string) => name.trim().toLowerCase();

type AliasIndex = {
  /** Lowercased alias or canonical name → canonical name as stored. */
  canonicalOf: Map<string, string>;
  /** Lowercased canonical name → every lowercased spelling in its group. */
  groups: Map<string, Set<string>>;
};

function buildIndex(rows: AliasRow[]): AliasIndex {
  const canonicalOf = new Map<string, string>();
  const groups = new Map<string, Set<string>>();
  for (const { alias, canonical_name } of rows) {
    const canonicalKey = key(canonical_name);
    canonicalOf.set(key(alias), canonical_name);
    canonicalOf.set(canonicalKey, canonical_name);
    const group = groups.get(canonicalKey) ?? new Set([canonicalKey]);
    group.add(key(alias));
    groups.set(canonicalKey, group);
  }
  return { canonicalOf, groups };
}

/** The alias index, or null when the table can't be read (reported, not thrown). */
async function loadIndex(): Promise<AliasIndex | null> {
  try {
    return buildIndex(await loadAliasRows());
  } catch (error) {
    await eventCaptureServerException({
      error,
      distinctId: "server",
      properties: { flow: "location_aliases" },
    });
    return null;
  }
}

/**
 * Lowercased location names to filter jobs by: each requested name plus every
 * spelling in its alias group. Job ingestion doesn't always apply aliases
 * ("Bangalore, Karnataka" is stored as "bangalore", "Bangalore" as
 * "bengaluru"), so a filter must match the whole group, not just the canonical
 * name. Unknown names pass through. If the aliases can't be read, the plain
 * names are used so search still works.
 */
export async function expandLocations(names: string[]): Promise<string[]> {
  const requested = names.map(key).filter(Boolean);
  if (requested.length === 0) return [];

  const index = await loadIndex();
  const expanded = new Set<string>();
  for (const name of requested) {
    expanded.add(name);
    const canonical = index?.canonicalOf.get(name);
    if (canonical) index!.groups.get(key(canonical))?.forEach((spelling) => expanded.add(spelling));
  }
  return [...expanded];
}

/**
 * Location names to save on a profile: aliases become their canonical name
 * (as stored), unknown names are kept as typed (trimmed), and names for the
 * same place are de-duplicated.
 */
export async function canonicalizeLocations(names: string[]): Promise<string[]> {
  const requested = names.map((name) => name.trim()).filter(Boolean);
  if (requested.length === 0) return [];

  const index = await loadIndex();
  const result: string[] = [];
  const seen = new Set<string>();
  for (const name of requested) {
    const canonical = index?.canonicalOf.get(key(name)) ?? name;
    if (seen.has(key(canonical))) continue;
    seen.add(key(canonical));
    result.push(canonical);
  }
  return result;
}
