import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deploymentUrl } from "@/utils/formatters";
import type { Database } from "@/utils/types/database.types";

// BI-REQ-041: the claim link in an imported applicant's interview emails. A
// random token; only its sha256 is stored (company_candidate_claims), and
// claim_company_candidate hashes what it's given the same way. It works once
// and expires with the interview's deadline.

export const newClaimToken = () => randomBytes(32).toString("base64url");

export const hashClaimToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

export const claimUrl = (token: string) => `${deploymentUrl()}/claim/${token}`;

/** Stores a new claim link for the candidate's interview (service role) and returns its URL. */
export async function createClaimLink(
  admin: SupabaseClient<Database>,
  link: { companyId: string; candidateId: string; applicationInterviewId: string; expiresAt: string },
): Promise<string> {
  const token = newClaimToken();
  const { error } = await admin.from("company_candidate_claims").insert({
    token_hash: hashClaimToken(token),
    company_id: link.companyId,
    candidate_id: link.candidateId,
    application_interview_id: link.applicationInterviewId,
    expires_at: link.expiresAt,
  });
  if (error) throw new Error(`Failed to store the claim link: ${error.message}`);
  return claimUrl(token);
}
