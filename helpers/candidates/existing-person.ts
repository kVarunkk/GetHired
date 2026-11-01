import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/utils/types/database.types";

/** Who an email already belongs to, for the hand-add form (BI-REQ-009). */
export type ExistingPerson = { kind: "candidate" | "user"; id: string; href: string };

/**
 * The company's own candidate with this email, else a GetHired user the
 * caller can already see (`match_known_applicants`, BI-REQ-019), else null.
 * The candidate lookup uses the service role, because a member who can add
 * candidates for one job can't read the whole pool; it returns only the id,
 * and the candidate page still checks access. Call it after the permission
 * check, with the session's company and client.
 */
export async function findExistingPerson(
  supabase: SupabaseClient<Database>,
  companyId: string,
  email: string,
): Promise<ExistingPerson | null> {
  const normalized = email.trim().toLowerCase();
  const { data: candidate, error } = await createServiceRoleClient()
    .from("company_candidates")
    .select("id")
    .eq("company_id", companyId)
    .eq("email", normalized)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to check the email: ${error.message}`);
  if (candidate) return { kind: "candidate", id: candidate.id, href: `/company/candidates/${candidate.id}` };

  const { data: known, error: knownError } = await supabase.rpc("match_known_applicants", {
    p_emails: [normalized],
  });
  if (knownError) throw new Error(`Failed to check the email: ${knownError.message}`);
  const user = known?.[0];
  return user ? { kind: "user", id: user.user_id, href: `/company/profiles/${user.user_id}` } : null;
}
