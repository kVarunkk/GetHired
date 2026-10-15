import { SCREENING_LIMITS, recommendationFor } from "./config";
import type { ScreeningResult } from "./schemas";

const trimText = (text: string, max: number) => text.trim().slice(0, max);

const trimList = (items: string[], max: number) =>
  items
    .map((item) => trimText(item, SCREENING_LIMITS.itemChars))
    .filter(Boolean)
    .slice(0, max);

/**
 * Makes a parsed screening consistent (MT-GUD-001, MT-REQ-006): the score is
 * clamped to 0–100, the recommendation follows the score's band, arrays and
 * strings are cut to their caps, and the answer feedback has exactly one
 * entry per question, in order. Flags can't be checked against the job in
 * code, so they're only capped.
 */
export function normaliseScreening(result: ScreeningResult, questionCount: number): ScreeningResult {
  const fitScore = Math.min(100, Math.max(0, Math.round(result.fit_score)));

  const feedbackByIndex = new Map<number, ScreeningResult["answer_feedback"][number]>();
  for (const entry of result.answer_feedback) {
    const i = entry.question_index;
    if (!Number.isInteger(i) || i < 0 || i >= questionCount || feedbackByIndex.has(i)) continue;
    feedbackByIndex.set(i, { ...entry, note: trimText(entry.note, SCREENING_LIMITS.noteChars) });
  }
  const answerFeedback = Array.from(
    { length: questionCount },
    (_, i) => feedbackByIndex.get(i) ?? { question_index: i, quality: "missing" as const, note: "" },
  );

  return {
    fit_score: fitScore,
    recommendation: recommendationFor(fitScore),
    summary: trimText(result.summary, SCREENING_LIMITS.summaryChars),
    strengths: trimList(result.strengths, SCREENING_LIMITS.strengths),
    gaps: trimList(result.gaps, SCREENING_LIMITS.gaps),
    must_have_coverage: result.must_have_coverage
      .map((entry) => ({
        requirement: trimText(entry.requirement, SCREENING_LIMITS.requirementChars),
        met: entry.met,
        evidence: trimText(entry.evidence, SCREENING_LIMITS.evidenceChars),
      }))
      .filter((entry) => entry.requirement)
      .slice(0, SCREENING_LIMITS.mustHaves),
    answer_feedback: answerFeedback,
    flags: trimList(result.flags, SCREENING_LIMITS.flags),
  };
}
