import { reportError } from "@/helpers/posthog/report-error";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { TelemetryOptions } from "ai";
import type { Database, Json } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { transition } from "@/helpers/db/transition";
import { isExplanationReady } from "@/helpers/matching/explanation-status";
import { MATCH_EXPLAIN_TIMEOUT_MS } from "./config";
import type { MatchErrorCode } from "./errors";
import { explainMatch } from "./explain-match";
import { loadCandidate, loadDirectoryCandidate, MATCH_JOB_COLUMNS } from "./load-candidate";
import { parseStoredExplanation, type MatchExplanation } from "./schemas";

/**
 * SM-ISS-003, SM-TEST-010: an on-demand failure never overwrites an
 * explanation (`completed`), nor a row a worker is running (`processing`),
 * whose own write decides it.
 */
const FAIL_FROM = ["none", "queued", "stale", "failed", "skipped_quota"] as const;

/**
 * An on-demand result is saved over anything but an explanation a worker
 * saved meanwhile. A running worker's save is then refused by its claim, and
 * it doesn't charge.
 */
const SAVE_FROM = [...FAIL_FROM, "processing"] as const;

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
  { abortSignal, telemetry }: { abortSignal?: AbortSignal; telemetry?: TelemetryOptions } = {},
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

  if (isExplanationReady(match?.explanation_status)) {
    const cached = parseStoredExplanation(match.explanation);
    if (cached) return { ok: true, explanation: cached, cached: true };
  }

  // Talent-pool candidates come from the directory with the company's own
  // client; only a candidate outside it (a private applicant, whose row the
  // company may read) is loaded with the service role.
  const admin = createServiceRoleClient();
  const candidate =
    (await loadDirectoryCandidate(supabase, candidateId)) ?? (await loadCandidate(admin, candidateId));
  if (!candidate) return { ok: false, reason: "not_found" };

  const result = await explainMatch(
    { job, profile: candidate.profile, resume: candidate.resume },
    { abortSignal, timeoutMs: MATCH_EXPLAIN_TIMEOUT_MS, telemetry },
  );

  if (!result.ok) {
    if (match) {
      await transition(
        admin,
        "job_relevant_profiles",
        { id: match.id, column: "explanation_status" },
        { from: FAIL_FROM, to: "failed", patch: { explanation_error: result.errorCode } },
      );
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
    try {
      await transition(
        admin,
        "job_relevant_profiles",
        { id: match.id, column: "explanation_status" },
        {
          from: SAVE_FROM,
          to: "completed",
          patch: {
            explanation: result.explanation as unknown as Json,
            explanation_error: null,
            explained_at: new Date().toISOString(),
          },
        },
      );
    } catch (err) {
      reportError("[matches/explain] couldn't store the explanation", err);
    }
  }

  return { ok: true, explanation: result.explanation, cached: false };
}
