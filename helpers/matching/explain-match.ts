import { generateText, Output, type LanguageModel } from "ai";
import { google } from "@ai-sdk/google";
import type { TResumeRowContent } from "@/utils/types";
import { buildMatchInput } from "./build-input";
import { MATCH_EXPLANATION_LIMITS, MT_MODEL } from "./config";
import { DATA_NOT_INSTRUCTIONS, FAIRNESS_RULES } from "./prompts";
import { MatchExplanationSchema, normaliseExplanation, type MatchExplanation } from "./schemas";
import { matchErrorCode, type MatchErrorCode } from "./errors";

export const EXPLAIN_MATCH_SYSTEM_PROMPT = `You explain to a recruiter why a candidate from the talent pool matches one of their jobs.
Be specific and grounded: every point must come from the job or the candidate's profile and resume. If the evidence isn't there, leave the point out rather than guess.

${DATA_NOT_INSTRUCTIONS}

${FAIRNESS_RULES}

Return:
- summary: one plain sentence, at most ${MATCH_EXPLANATION_LIMITS.summaryChars} characters.
- strengths: up to ${MATCH_EXPLANATION_LIMITS.items} job requirements the candidate clearly meets, each with the evidence.
- gaps: up to ${MATCH_EXPLANATION_LIMITS.items} job requirements the candidate doesn't show.
- conflicts: up to ${MATCH_EXPLANATION_LIMITS.items} clashes between the candidate's stated preferences and the job (e.g. "wants remote; job is onsite in Pune"). Empty if none.`;

export type ExplainMatchResult =
  | { ok: true; explanation: MatchExplanation }
  | { ok: false; errorCode: MatchErrorCode };

/**
 * "Why this candidate" for one (job, candidate) pair (MT-TASK-010). A pure
 * function of its inputs and the model. Never throws, and never returns a
 * raw provider message (MT-SEC-005).
 */
export async function explainMatch(
  {
    job,
    profile,
    resume,
  }: {
    job: Parameters<typeof buildMatchInput>[0];
    profile: Record<string, unknown>;
    resume: TResumeRowContent | null;
  },
  {
    model,
    abortSignal,
    timeoutMs,
  }: { model?: LanguageModel; abortSignal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ExplainMatchResult> {
  const signals = [abortSignal, timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined].filter(
    (s): s is AbortSignal => !!s,
  );
  const signal = signals.length ? AbortSignal.any(signals) : undefined;

  try {
    const { output } = await generateText({
      model: model ?? google(MT_MODEL),
      system: EXPLAIN_MATCH_SYSTEM_PROMPT,
      prompt: buildMatchInput(job, profile, resume),
      output: Output.object({ schema: MatchExplanationSchema }),
      abortSignal: signal,
      maxRetries: 1,
    });

    return { ok: true, explanation: normaliseExplanation(output) };
  } catch (error) {
    return { ok: false, errorCode: matchErrorCode(error, signal) };
  }
}
