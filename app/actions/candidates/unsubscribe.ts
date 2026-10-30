"use server";

import { z } from "zod";
import { verifyUnsubscribeToken } from "@/helpers/candidates/unsubscribe-token";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const inputSchema = z.object({ token: z.string().min(1).max(200) }).strict();

export type UnsubscribeCandidateResult = { ok: true } | { ok: false; error: string };

/**
 * SERVER ACTION (BI-REQ-034), public: the person behind an unsubscribe link
 * stops a company's emails. The signed token is the only authority, so the
 * write goes through the service role, and only ever sets
 * `email_opted_out_at` on the candidate it names. Idempotent: the first
 * time is kept.
 */
export async function unsubscribeCandidateAction(
  input: z.input<typeof inputSchema>,
): Promise<UnsubscribeCandidateResult> {
  const parsed = inputSchema.safeParse(input);
  const candidateId = parsed.success ? verifyUnsubscribeToken(parsed.data.token) : null;
  if (!candidateId) return { ok: false, error: "This link isn't valid." };

  const { error } = await createServiceRoleClient()
    .from("company_candidates")
    .update({ email_opted_out_at: new Date().toISOString() })
    .eq("id", candidateId)
    .is("email_opted_out_at", null);
  if (error) throw new Error(`Failed to unsubscribe: ${error.message}`);
  return { ok: true };
}
