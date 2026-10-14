import type { User } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";

/**
 * BL-SEC-004: billing actions (checkout, plan changes, the portal) need the
 * company's owner or an admin. Until the teams spec adds roles, the company's
 * one user is its owner, so a resolved company session is enough. TM replaces
 * this with a role check (BLT-103).
 */
export function canManageBilling(user: User, company: MyCompany): boolean {
  return Boolean(user && company);
}

export const BILLING_FORBIDDEN = "Only the company's owner or an admin can manage billing.";
