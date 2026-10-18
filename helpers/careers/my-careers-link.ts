import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

/** CP-REQ-014: the session company's careers address and whether it's live. */
export async function getMyCareersLink(
  supabase: SupabaseClient<Database>,
  companyId: string,
): Promise<{ slug: string; published: boolean } | null> {
  const { data } = await supabase
    .from("company_info")
    .select("careers_slug, careers_published")
    .eq("id", companyId)
    .maybeSingle();
  return data?.careers_slug ? { slug: data.careers_slug, published: data.careers_published } : null;
}
