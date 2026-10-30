import type { SupabaseClient } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import type { Database } from "@/utils/types/database.types";

/**
 * What the import helpers need from the caller: the session's RLS client, its
 * company and user. A server action passes its `requireCompanyForAction`
 * result and the recruiter agent its tool context, so both run the same code
 * after their own permission check. Never the service role.
 */
export type ImportSession = {
  supabase: SupabaseClient<Database>;
  company: MyCompany;
  user: { id: string };
};
