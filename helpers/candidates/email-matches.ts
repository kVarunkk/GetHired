import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/utils/types/database.types";
import type { EmailMatches } from "./preview-rows";

/** Emails per `in` filter: they go in the request URL. */
const CHUNK = 150;

/**
 * BI-REQ-014/019: which of these emails are already the company's
 * candidates, and which belong to GetHired users the member can already see
 * (`match_known_applicants`, through the member's own client). The candidate
 * lookup uses the service role, as `findExistingPerson` does: a member who
 * imports for one job can't read the whole pool, and it returns only email
 * and id. Shared by `checkImportEmailsAction` and the agent's staged sheets.
 */
export async function matchImportEmails(
  supabase: SupabaseClient<Database>,
  companyId: string,
  rawEmails: readonly string[],
): Promise<EmailMatches> {
  const emails = [...new Set(rawEmails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")))];
  if (emails.length === 0) return { existing: [], known: [] };

  const admin = createServiceRoleClient();
  const chunks = Array.from({ length: Math.ceil(emails.length / CHUNK) }, (_, i) => emails.slice(i * CHUNK, (i + 1) * CHUNK));
  const [found, { data: known, error: knownError }] = await Promise.all([
    Promise.all(
      chunks.map(async (chunk) => {
        const { data, error } = await admin
          .from("company_candidates")
          .select("id, email")
          .eq("company_id", companyId)
          .in("email", chunk);
        if (error) throw new Error(`Failed to check the emails: ${error.message}`);
        return data ?? [];
      }),
    ),
    supabase.rpc("match_known_applicants", { p_emails: emails }),
  ]);
  if (knownError) throw new Error(`Failed to check the emails: ${knownError.message}`);

  return {
    existing: found.flat().flatMap((c) => (c.email ? [{ email: c.email, id: c.id }] : [])),
    known: (known ?? []).map((k) => ({ email: k.email, userId: k.user_id, fullName: k.full_name })),
  };
}
