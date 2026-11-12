import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { hashClaimToken } from "./claim-token";

/** `company_candidate_claim_state`: the reading claim_company_candidate uses too. */
export type ClaimState = "unused" | "used" | "expired";
const CLAIM_STATES: readonly string[] = ["unused", "used", "expired"] satisfies ClaimState[];

export type ClaimInfo = {
  companyName: string;
  jobTitle: string | null;
  state: ClaimState;
  usedBy: string | null;
};

export type ClaimView = "invalid" | "expired" | "used" | "signed_out" | "company_account" | "confirm";

/**
 * BI-REQ-041: what the claim page shows about a link, read with the service
 * role (the claims table has no client access). Only the company's name and
 * the job's title: nothing about the candidate, since anyone with the link
 * can open the page.
 */
export async function loadClaim(admin: SupabaseClient<Database>, token: string): Promise<ClaimInfo | null> {
  if (!/^[\w-]{20,200}$/.test(token)) return null;
  const { data, error } = await admin
    .from("company_candidate_claims")
    .select("state:company_candidate_claim_state, used_by, company_info(name), application_interviews(config_snapshot)")
    .eq("token_hash", hashClaimToken(token))
    .maybeSingle();
  if (error) throw new Error(`Failed to load the claim link: ${error.message}`);
  if (!data || !data.state || !CLAIM_STATES.includes(data.state)) return null;
  const snapshot = data.application_interviews?.config_snapshot as { job_title?: string } | null | undefined;
  return {
    companyName: data.company_info?.name ?? "The company",
    jobTitle: snapshot?.job_title ?? null,
    state: data.state as ClaimState,
    usedBy: data.used_by,
  };
}

/**
 * Which state the page is in. Mirrors claim_company_candidate's checks, from
 * the same named state, so the button only shows when the claim should work;
 * the function still decides.
 */
export function claimViewFor(claim: ClaimInfo | null, user: { id: string; type: unknown } | null): ClaimView {
  if (!claim || !CLAIM_STATES.includes(claim.state)) return "invalid";
  if (claim.state === "used") {
    if (user && claim.usedBy === user.id) return user.type === "company" ? "company_account" : "confirm";
    return "used";
  }
  if (claim.state === "expired") return "expired";
  if (!user) return "signed_out";
  return user.type === "company" ? "company_account" : "confirm";
}
