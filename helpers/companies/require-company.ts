import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/utils/types/database.types";
import { getMyCompany, type MyCompany } from "./get-my-company";

type CompanySession = {
  ok: true;
  user: User;
  /** The RLS-scoped client for the request's user, never the service role. */
  supabase: SupabaseClient<Database>;
  company: MyCompany;
};

export type CompanyAuth = CompanySession | { ok: false; response: NextResponse };
export type CompanyActionAuth = CompanySession | { ok: false; error: string };

type Failure = { status: 401 | 403; error: string };

async function resolveCompany(): Promise<CompanySession | Failure> {
  const user = await getUserFromRequest();
  if (!user) return { status: 401, error: "Unauthorized" };

  if (user.app_metadata?.type !== "company") {
    return { status: 403, error: "Only company accounts can do this." };
  }

  const supabase = await createClient();
  const company = await getMyCompany(supabase, user);
  if (!company) {
    return { status: 403, error: "Set up your company profile first." };
  }

  return { ok: true, user, supabase, company };
}

/**
 * Authenticates a company API route (RS-SEC-001): 401 without a user, 403 for
 * applicants and for company users without a `company_info` row. The company
 * always comes from the session.
 */
export async function requireCompany(): Promise<CompanyAuth> {
  const result = await resolveCompany();
  if ("ok" in result) return result;
  return {
    ok: false,
    response: NextResponse.json({ error: result.error }, { status: result.status }),
  };
}

/** The server-action flavour of `requireCompany`: returns `{ ok: false, error }`. */
export async function requireCompanyForAction(): Promise<CompanyActionAuth> {
  const result = await resolveCompany();
  if ("ok" in result) return result;
  return { ok: false, error: result.error };
}
