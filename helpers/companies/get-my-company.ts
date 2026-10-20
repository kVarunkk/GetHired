import { after } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import {
  isPermissionKey,
  ROLE_LIMIT_KEYS,
  type CompanyAccess,
  type PermissionKey,
  type PermissionScope,
  type RoleLimits,
} from "./permissions";

export type CompanyRoleSummary = { id: string; name: string; color: string };

export type MyCompany = CompanyAccess & {
  id: string;
  name: string | null;
  email: string | null;
  /** The member's display name, used for attribution (TM-REQ-008). */
  displayName: string | null;
  /** `company_info.user_id`: the primary owner, the billing contact (RP-DEC-002). */
  ownerUserId: string | null;
  isPrimaryOwner: boolean;
  /** The member's role; null for owners (RP-DEC-001). */
  role: CompanyRoleSummary | null;
};

type AccessRow = {
  company: { id: string; name: string | null; email: string | null; user_id: string | null };
  display_name: string | null;
  is_owner: boolean;
  is_primary_owner: boolean;
  role: CompanyRoleSummary | null;
  grants: { key: string; scope: string }[] | null;
  assigned_job_ids: string[] | null;
  limits: Record<string, number> | null;
};

/** Maps `my_company_access()` to `MyCompany`. Unknown keys are dropped (RP-SEC-003). */
export function toMyCompany(row: AccessRow): MyCompany {
  const grants = new Map<PermissionKey, PermissionScope>();
  for (const g of row.grants ?? []) {
    if (isPermissionKey(g.key) && (g.scope === "all" || g.scope === "assigned")) grants.set(g.key, g.scope);
  }
  const limits: RoleLimits = {};
  for (const key of ROLE_LIMIT_KEYS) {
    const amount = row.limits?.[key];
    if (typeof amount === "number") limits[key] = amount;
  }
  return {
    id: row.company.id,
    name: row.company.name,
    email: row.company.email,
    displayName: row.display_name,
    ownerUserId: row.company.user_id,
    isOwner: Boolean(row.is_owner),
    isPrimaryOwner: Boolean(row.is_primary_owner),
    role: row.role ?? null,
    grants: row.is_owner ? new Map() : grants,
    assignedJobIds: new Set(row.assigned_job_ids ?? []),
    limits: row.is_owner ? {} : limits,
  };
}

/**
 * The company the session user acts for (RS-SEC-001) and what they may do in
 * it (RP-SEC-001), from `my_company_access()`: one round trip, always for
 * `auth.uid()`, so callers can never pick another company or widen their own
 * access. Read per request and never cached (RP-SEC-004). Returns `null` for
 * applicants (without querying) and for company users with no membership.
 * Database errors are thrown.
 */
export async function getMyCompany(
  supabase: SupabaseClient<Database>,
  user: User,
): Promise<MyCompany | null> {
  if (user.app_metadata?.type !== "company") return null;

  // Plans and limits come from helpers/billing/entitlements (BL-CON-002).
  const { data, error } = await supabase.rpc("my_company_access");

  if (error) throw new Error(`Failed to load the company: ${error.message}`);
  if (!data) return null;

  touchMembership(supabase);

  return toMyCompany(data as unknown as AccessRow);
}

// last_active_at for the team page. The RPC writes at most every 10 minutes
// (the throttle is in SQL), so calling it on every lookup is cheap.
function touchMembership(supabase: SupabaseClient<Database>) {
  try {
    after(async () => {
      try {
        await supabase.rpc("touch_company_membership");
      } catch {
        // Best effort.
      }
    });
  } catch {
    // Outside a request scope (scripts): skip it.
  }
}
