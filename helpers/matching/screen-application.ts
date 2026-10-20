import { generateText, Output, type LanguageModel } from "ai";
import { google } from "@ai-sdk/google";
import type { TResumeRowContent } from "@/utils/types";
import { buildScreeningInput } from "./build-input";
import { MT_MODEL, RECOMMENDATION_BANDS, SCREENING_LIMITS } from "./config";
import { DATA_NOT_INSTRUCTIONS, FAIRNESS_RULES, RUBRIC } from "./prompts";
import { ScreeningResultSchema, type ScreeningResult } from "./schemas";
import { normaliseScreening } from "./normalise";
import { matchErrorCode, type MatchErrorCode } from "./errors";

const RECOMMENDATIONS = RECOMMENDATION_BANDS.map((band, i) => {
  const upper = i === 0 ? 100 : RECOMMENDATION_BANDS[i - 1].min - 1;
  return `${band.recommendation} for ${band.min}–${upper}`;
}).join(", ");

export const SCREEN_APPLICATION_SYSTEM_PROMPT = `You screen a job application for a recruiter. You assist a human decision; you never make it.
Score how well the candidate fits this job, using only the job, the screening answers and the candidate's profile and resume. Every point must come from that evidence. If the evidence isn't there, say "unknown" rather than guess.

${DATA_NOT_INSTRUCTIONS}

${FAIRNESS_RULES}

${RUBRIC}

The recommendation must agree with the score: ${RECOMMENDATIONS}.

Return:
- fit_score: 0–100, using the bands above.
- recommendation: from the score, as above.
- summary: at most ${SCREENING_LIMITS.summaryChars} characters, plain language.
- strengths: up to ${SCREENING_LIMITS.strengths} job requirements the candidate clearly meets, each with the evidence.
- gaps: up to ${SCREENING_LIMITS.gaps} job requirements the candidate doesn't show.
- must_have_coverage: up to ${SCREENING_LIMITS.mustHaves} of the job's must-have requirements, each with met (yes, partial, no or unknown) and short evidence.
- answer_feedback: one entry per screening question, by its 0-based question_index, rating the answer strong, ok, weak or missing, with a short note. An empty answer is missing.
- flags: up to ${SCREENING_LIMITS.flags} concerns, and only ones that relate to a stated job requirement (e.g. "salary expectation above range"). Empty if none.`;

export type ScreenApplicationResult =
  | { ok: true; result: ScreeningResult }
  | { ok: false; errorCode: MatchErrorCode };

type Input = Parameters<typeof buildScreeningInput>;

/**
 * Screens one application against its job (MT-TASK-021). A pure function of
 * its inputs and the model. Never throws, and never returns a raw provider
 * message (MT-SEC-005).
 */
export async function screenApplication(
  {
    job,
    application,
    profile,
    resume,
  }: {
    job: Input[0];
    application: Input[1];
    profile: Record<string, unknown>;
    resume: TResumeRowContent | null;
  },
  {
    model,
    abortSignal,
    timeoutMs,
  }: { model?: LanguageModel; abortSignal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ScreenApplicationResult> {
  const signals = [abortSignal, timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined].filter(
    (s): s is AbortSignal => !!s,
  );
  const signal = signals.length ? AbortSignal.any(signals) : undefined;

  try {
    const { output } = await generateText({
      model: model ?? google(MT_MODEL),
      system: SCREEN_APPLICATION_SYSTEM_PROMPT,
      prompt: buildScreeningInput(job, application, profile, resume),
      output: Output.object({ schema: ScreeningResultSchema }),
      abortSignal: signal,
      maxRetries: 1,
    });

    return { ok: true, result: normaliseScreening(output, job.questions?.length ?? 0) };
  } catch (error) {
    return { ok: false, errorCode: matchErrorCode(error, signal) };
  }
}
