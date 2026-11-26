import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

/**
 * The company's IANA time zone (`company_info.time_zone`), or null when unset,
 * which callers read as UTC, as `company_today()` does in SQL.
 */
export async function loadCompanyTimeZone(
  supabase: SupabaseClient<Database>,
  companyId: string,
): Promise<string | null> {
  const { data, error } = await supabase.from("company_info").select("time_zone").eq("id", companyId).maybeSingle();
  if (error) throw new Error("Failed to load the company's time zone.");
  return data?.time_zone ?? null;
}
