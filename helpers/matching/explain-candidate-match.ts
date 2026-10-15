import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { MATCH_EXPLAIN_TIMEOUT_MS } from "./config";
import type { MatchErrorCode } from "./errors";
import { explainMatch } from "./explain-match";
import { loadCandidate, MATCH_JOB_COLUMNS } from "./load-candidate";
import { parseStoredExplanation, type MatchExplanation } from "./schemas";

export type ExplainCandidateMatchResult =
  | { ok: true; explanation: MatchExplanation; cached: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "model"; errorCode: MatchErrorCode }
  | { ok: false; reason: "entitlement"; error: EntitlementError };

/**
 * "Why this match?" for one candidate of one of `company`'s jobs (MT-REQ-003).
 * Returns the cached explanation, or generates, charges and stores one.
 * Shared by POST /api/company/matches/explain and the agent's explainMatch
 * tool; `supabase`, `company` and `user` come from the session. Another
 * company's job, or a candidate the company can't see, is "not_found".
 */
export async function explainCandidateMatch(
  { supabase, company, user }: { supabase: SupabaseClient<Database>; company: MyCompany; user: User },
  { jobPostId, candidateId }: { jobPostId: string; candidateId: string },
  { abortSignal }: { abortSignal?: AbortSignal } = {},
): Promise<ExplainCandidateMatchResult> {
  const { data: job } = await supabase
    .from("job_postings")
    .select(MATCH_JOB_COLUMNS)
    .eq("id", jobPostId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!job) return { ok: false, reason: "not_found" };

  const { data: match } = await supabase
    .from("job_relevant_profiles")
    .select("id, explanation, explanation_status")
    .eq("job_posting_id", jobPostId)
    .eq("user_id", candidateId)
    .maybeSingle();

  if (!match) {
    const { data: canView } = await supabase.rpc("company_can_view_candidate", {
      p_user_id: candidateId,
    });
    if (!canView) return { ok: false, reason: "not_found" };
  }

  if (match?.explanation_status === "completed") {
    const cached = parseStoredExplanation(match.explanation);
    if (cached) return { ok: true, explanation: cached, cached: true };
  }

  const admin = createServiceRoleClient();
  const candidate = await loadCandidate(admin, candidateId);
  if (!candidate) return { ok: false, reason: "not_found" };

  const result = await explainMatch(
    { job, profile: candidate.profile, resume: candidate.resume },
    { abortSignal, timeoutMs: MATCH_EXPLAIN_TIMEOUT_MS },
  );

  if (!result.ok) {
    if (match) {
      await admin
        .from("job_relevant_profiles")
        .update({ explanation_status: "failed", explanation_error: result.errorCode })
        .eq("id", match.id);
    }
    return { ok: false, reason: "model", errorCode: result.errorCode };
  }

  // Charged only after a successful call (BL-TASK-030). The ref makes a
  // retry, or the background worker for the same row, free (MTT-041).
  try {
    await consumeEntitlement(
      company.id,
      "match_explanations",
      1,
      { type: "match_explanation", id: match?.id ?? `${jobPostId}:${candidateId}` },
      user.id,
    );
  } catch (err) {
    if (err instanceof EntitlementError) return { ok: false, reason: "entitlement", error: err };
    throw err;
  }

  if (match) {
    const { error } = await admin
      .from("job_relevant_profiles")
      .update({
        explanation: result.explanation,
        explanation_status: "completed",
        explanation_error: null,
        explained_at: new Date().toISOString(),
      })
      .eq("id", match.id);
    if (error) console.error("[matches/explain] couldn't store the explanation", error.message);
  }

  return { ok: true, explanation: result.explanation, cached: false };
}
