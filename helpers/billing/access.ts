import type { User } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";

/**
 * BL-SEC-004 / RP-DEC-003: billing management (checkout, plan changes, the
 * portal) is for the company's owners only, and isn't a grantable
 * permission. Every owner may manage it; the primary owner is the billing
 * contact. Ownership comes from the membership row through `getMyCompany`.
 */
export function canManageBilling(user: User | null | undefined, company: MyCompany | null | undefined): boolean {
  return Boolean(user && company?.isOwner);
}

/** RP-DEC-003: seeing the plan, usage, credits and invoices is `billing.view`. */
export function canViewBilling(company: MyCompany | null | undefined): boolean {
  return can(company, "billing.view");
}

export const BILLING_FORBIDDEN = "Only the company's owners can manage billing.";
