import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/utils/types/database.types";
import { getMyCompany, type MyCompany } from "./get-my-company";
import { can, canAny, forbiddenMessage, OWNER_ONLY_MESSAGE, type PermissionKey } from "./permissions";

type CompanySession = {
  ok: true;
  user: User;
  /** The RLS-scoped client for the request's user, never the service role. */
  supabase: SupabaseClient<Database>;
  company: MyCompany;
};

/** `no_membership`: a company account with no `company_members` row. `permission`: RP-SEC-001. */
export type CompanyAuthReason = "unauthenticated" | "not_company" | "no_membership" | "permission";

export type CompanyAuth =
  | CompanySession
  | { ok: false; response: NextResponse; reason: CompanyAuthReason };
export type CompanyActionAuth =
  | CompanySession
  | { ok: false; error: string; reason: CompanyAuthReason };

/**
 * RP-SEC-001. Every company action and route names what it needs:
 * - `permission`: a catalog key. With `jobId` omitted, any scope will do (the
 *   rows are filtered by RLS, e.g. a list). With `jobId: null` it needs scope
 *   `all` (a row without a job). With a job id, the scope must cover that job.
 * - `owner: true`: owners only (billing management, owner changes, RP-DEC-003).
 * - Neither: membership only (allowlisted in test/require-company-usage.test.ts).
 */
export type RequireCompanyOptions = {
  permission?: PermissionKey;
  jobId?: string | null;
  owner?: true;
};

export const NO_MEMBERSHIP =
  "You're no longer part of a company on GetHired. Ask your team for a new invite.";

type Failure = { status: 401 | 403; error: string; reason: CompanyAuthReason };

/** Whether `company` passes `options` (the check `requireCompany` makes, for reuse). */
export function companyAllows(company: MyCompany, options: RequireCompanyOptions): string | null {
  if (options.owner && !company.isOwner) return OWNER_ONLY_MESSAGE;
  const key = options.permission;
  if (!key) return null;
  if (options.jobId === undefined) return canAny(company, key) ? null : forbiddenMessage(key);
  return can(company, key, options.jobId)
    ? null
    : forbiddenMessage(key, { forJob: options.jobId !== null && canAny(company, key) });
}

async function resolveCompany(options: RequireCompanyOptions): Promise<CompanySession | Failure> {
  const user = await getUserFromRequest();
  if (!user) return { status: 401, error: "Unauthorized", reason: "unauthenticated" };

  if (user.app_metadata?.type !== "company") {
    return { status: 403, error: "Only company accounts can do this.", reason: "not_company" };
  }

  const supabase = await createClient();
  const company = await getMyCompany(supabase, user);
  if (!company) {
    // An onboarded account without a membership was removed from its company.
    const error = user.app_metadata?.onboarding_complete
      ? NO_MEMBERSHIP
      : "Set up your company profile first.";
    return { status: 403, error, reason: "no_membership" };
  }

  // Permissions always come from the database for the session user (RP-SEC-004).
  const denied = companyAllows(company, options);
  if (denied) return { status: 403, error: denied, reason: "permission" };

  return { ok: true, user, supabase, company };
}

/**
 * Authenticates a company API route (RS-SEC-001): 401 without a user, 403 for
 * applicants, for company users without a membership and for members without
 * the permission. The company and the permissions always come from the session.
 */
export async function requireCompany(options: RequireCompanyOptions = {}): Promise<CompanyAuth> {
  const result = await resolveCompany(options);
  if ("ok" in result) return result;
  return {
    ok: false,
    reason: result.reason,
    response: NextResponse.json({ error: result.error }, { status: result.status }),
  };
}

/** The server-action flavour of `requireCompany`: returns `{ ok: false, error }`. */
export async function requireCompanyForAction(
  options: RequireCompanyOptions = {},
): Promise<CompanyActionAuth> {
  const result = await resolveCompany(options);
  if ("ok" in result) return result;
  return { ok: false, error: result.error, reason: result.reason };
}
