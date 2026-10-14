import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCompany } from "@/helpers/companies/require-company";
import { consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError, toEntitlementResponse } from "@/helpers/billing/errors";
import { explainMatch } from "@/helpers/matching/explain-match";
import { MATCH_EXPLAIN_TIMEOUT_MS } from "@/helpers/matching/config";
import { loadCandidate, MATCH_JOB_COLUMNS } from "@/helpers/matching/load-candidate";
import { parseStoredExplanation } from "@/helpers/matching/schemas";
import type { MatchErrorCode } from "@/helpers/matching/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const BodySchema = z.object({
  jobPostId: z.string().uuid(),
  candidateId: z.string().uuid(),
});

const FAILURE: Record<MatchErrorCode, { status: number; error: string }> = {
  model_error: { status: 502, error: "Couldn't explain this match right now. Please try again." },
  invalid_output: { status: 502, error: "Couldn't explain this match right now. Please try again." },
  timeout: { status: 504, error: "Explaining this match took too long. Please try again." },
};

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

/**
 * "Why this match?" for one candidate of one of the company's jobs
 * (MT-REQ-003, MT-TASK-011). Returns the cached explanation, or generates,
 * charges and stores one.
 */
export async function POST(request: NextRequest) {
  const auth = await requireCompany();
  if (!auth.ok) return auth.response;
  const { supabase, company, user } = auth;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "jobPostId and candidateId must be UUIDs." }, { status: 422 });
  }
  const { jobPostId, candidateId } = parsed.data;

  // Another company's job is a 404, so its existence isn't confirmed.
  const { data: job } = await supabase
    .from("job_postings")
    .select(MATCH_JOB_COLUMNS)
    .eq("id", jobPostId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!job) return notFound();

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
    if (!canView) return notFound();
  }

  if (match?.explanation_status === "completed") {
    const cached = parseStoredExplanation(match.explanation);
    if (cached) return NextResponse.json({ explanation: cached });
  }

  const admin = createServiceRoleClient();
  const candidate = await loadCandidate(admin, candidateId);
  if (!candidate) return notFound();

  const result = await explainMatch(
    { job, profile: candidate.profile, resume: candidate.resume },
    { abortSignal: request.signal, timeoutMs: MATCH_EXPLAIN_TIMEOUT_MS },
  );

  if (!result.ok) {
    if (match) {
      await admin
        .from("job_relevant_profiles")
        .update({ explanation_status: "failed", explanation_error: result.errorCode })
        .eq("id", match.id);
    }
    const failure = FAILURE[result.errorCode];
    return NextResponse.json({ error: failure.error, code: result.errorCode }, { status: failure.status });
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
    if (err instanceof EntitlementError) return toEntitlementResponse(err);
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

  return NextResponse.json({ explanation: result.explanation });
}
