import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCompany } from "@/helpers/companies/require-company";
import { toEntitlementResponse } from "@/helpers/billing/errors";
import { explainCandidateMatch } from "@/helpers/matching/explain-candidate-match";
import type { MatchErrorCode } from "@/helpers/matching/errors";

const BodySchema = z.object({
  jobPostId: z.string().uuid(),
  candidateId: z.string().uuid(),
});

const FAILURE: Record<MatchErrorCode, { status: number; error: string }> = {
  model_error: { status: 502, error: "Couldn't explain this match right now. Please try again." },
  invalid_output: { status: 502, error: "Couldn't explain this match right now. Please try again." },
  timeout: { status: 504, error: "Explaining this match took too long. Please try again." },
};

/**
 * "Why this match?" for one candidate of one of the company's jobs
 * (MT-REQ-003, MT-TASK-011). Returns the cached explanation, or generates,
 * charges and stores one (`helpers/matching/explain-candidate-match.ts`).
 */
export async function POST(request: NextRequest) {
  const auth = await requireCompany();
  if (!auth.ok) return auth.response;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "jobPostId and candidateId must be UUIDs." }, { status: 422 });
  }

  const result = await explainCandidateMatch(auth, parsed.data, { abortSignal: request.signal });

  if (result.ok) return NextResponse.json({ explanation: result.explanation });
  switch (result.reason) {
    // Another company's job is a 404, so its existence isn't confirmed.
    case "not_found":
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    case "entitlement":
      return toEntitlementResponse(result.error);
    case "model": {
      const failure = FAILURE[result.errorCode];
      return NextResponse.json(
        { error: failure.error, code: result.errorCode },
        { status: failure.status },
      );
    }
  }
}
