import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

/**
 * Candidate rows a company user may see, by user id (OR-SEC-001): talent-pool
 * candidates from `candidate_directory`, then applicants and Interested
 * candidates (who may be private) from `user_info`, which RLS opens for them.
 * `columns` must be directory columns, so neither source adds contact details.
 * Ids the company can't see are missing from the map.
 */
export async function loadVisibleCandidates<Row extends { user_id: string | null }>(
  supabase: SupabaseClient<Database>,
  ids: string[],
  columns: string,
): Promise<Map<string, Row>> {
  const result = new Map<string, Row>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return result;

  const { data: listed, error } = await supabase
    .from("candidate_directory")
    .select(columns)
    .in("user_id", unique);
  if (error) throw error;
  for (const row of (listed ?? []) as unknown as Row[]) if (row.user_id) result.set(row.user_id, row);

  const missing = unique.filter((id) => !result.has(id));
  if (missing.length > 0) {
    const { data: others, error: othersError } = await supabase
      .from("user_info")
      .select(columns)
      .in("user_id", missing);
    if (othersError) throw othersError;
    for (const row of (others ?? []) as unknown as Row[]) if (row.user_id) result.set(row.user_id, row);
  }
  return result;
}
