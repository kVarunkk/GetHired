import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

/**
 * Who gets an email meant for a company member (teams difference 7): the
 * member while they're still on the company's team, else the company's owner.
 * So a removed member never receives company mail (a candidate's contact
 * details, for one). Service role: it reads another user's membership.
 * Null when the company has no owner.
 */
export async function memberOrOwnerUserId(
  service: SupabaseClient<Database>,
  companyId: string,
  userId: string | null,
): Promise<string | null> {
  if (userId) {
    const { data: membership } = await service
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (membership) return userId;
  }

  // company_info.user_id is the owner (TM-CON-001).
  const { data: company } = await service.from("company_info").select("user_id").eq("id", companyId).maybeSingle();
  return company?.user_id ?? null;
}
