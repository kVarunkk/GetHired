"use server";

import { z } from "zod";
import { hasPrefill, loadClaimPrefill } from "@/helpers/candidates/claim-prefill";
import { claimMessage } from "@/helpers/candidates/copy";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const inputSchema = z.object({ token: z.string().min(20).max(200) }).strict();

export type ClaimCandidateResult =
  | { ok: true; href: string; offerPrefill: boolean }
  | { ok: false; error: string };

/**
 * SERVER ACTION (BI-REQ-041): the session's applicant claims the company
 * candidate behind a claim link, and lands on the interview it was sent for
 * (or their applications, when it's no longer open). The function checks the
 * token, so this only refuses what it can tell up front.
 *
 * BIT-105: `offerPrefill` is true when the account hasn't set up its profile
 * and the company's record has something to start it from. Nothing is saved
 * here: the page only offers it.
 */
export async function claimCandidateAction(input: z.input<typeof inputSchema>): Promise<ClaimCandidateResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: claimMessage("not_signed_in") };
  if (user.app_metadata?.type === "company") return { ok: false, error: claimMessage("company_account") };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: claimMessage("invalid") };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_company_candidate", { p_token: parsed.data.token });
  if (error) throw new Error(`Failed to claim: ${error.message}`);
  const result = (data ?? {}) as { ok?: boolean; reason?: string; application_interview_id?: string | null };
  if (!result.ok) return { ok: false, error: claimMessage(result.reason) };
  return {
    ok: true,
    href: result.application_interview_id ? `/interview/screening/${result.application_interview_id}` : "/dashboard",
    offerPrefill: await shouldOfferPrefill(supabase, user.id, parsed.data.token),
  };
}

/** Never fails the claim: without an answer, there's simply no offer. */
async function shouldOfferPrefill(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  token: string,
): Promise<boolean> {
  try {
    const { data: profile, error } = await supabase
      .from("user_info")
      .select("filled")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!profile || profile.filled) return false;
    return hasPrefill(await loadClaimPrefill(createServiceRoleClient(), token, userId));
  } catch (error) {
    await eventCaptureServerException({ error, distinctId: userId, properties: { flow: "claim_prefill_offer" } });
    return false;
  }
}
