import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "./get-my-company";

/**
 * A company member's resolved session: what `requireCompanyForAction` returns
 * on success, and what the recruiter agent and MCP already hold. Helpers that
 * take it read nothing from the request, so every surface can call them.
 */
export type CompanySessionContext = {
  /** The RLS-scoped client for the member, never the service role. */
  supabase: SupabaseClient<Database>;
  company: MyCompany;
  user: User;
};
