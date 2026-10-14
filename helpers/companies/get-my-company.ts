import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

export type MyCompany = {
  id: string;
  name: string | null;
  email: string | null;
};

/**
 * The company the session user acts for (RS-SEC-001). The row is always looked
 * up by `user.id`, so callers can never pick another company by passing an id.
 * Returns `null` for applicants (without querying) and for company users who
 * haven't created their company yet. Database errors are thrown.
 */
export async function getMyCompany(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<MyCompany | null> {
  if (user.app_metadata?.type !== "company") return null;

  const { data, error } = await supabase
    .from("company_info")
    // Plans and limits come from helpers/billing/entitlements (BL-CON-002).
    .select("id, name, email")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`Failed to load the company: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    email: data.email,
  };
}
