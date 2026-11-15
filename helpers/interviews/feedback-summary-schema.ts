// Client-safe (IV-REQ-051): the stored feedback summary's shape, shared by the
// summarizer, the loader and the Interviews section. It has no hire/no-hire
// field on purpose (D16): the stage move is the decision.

import type { CandidateRating } from "@/helpers/pipeline/ratings";

/** A verbatim line from one scorecard, with who wrote it and for which interview. */
export type SummaryQuote = { scorecardId: string; author: string; interview: string; quote: string };

export type SummaryPoint = { text: string; quotes: SummaryQuote[] };

/** Where the panel disagreed, per competency ("Overall" for the overall rating). */
export type SummaryDisagreement = SummaryPoint & { competency: string };

export type FeedbackSummary = {
  agreements: SummaryPoint[];
  disagreements: SummaryDisagreement[];
  concerns: SummaryPoint[];
};

export const SUMMARY_LIMITS = {
  agreements: 5,
  disagreements: 10,
  concerns: 5,
  quotesPerPoint: 3,
  text: 500,
} as const;

/** One submitted scorecard as `feedback_summary_source` returns it. */
export type SummarySourceCard = {
  id: string;
  interview_id: string;
  interview_name: string;
  competencies: { id: string; name: string }[];
  author_name: string | null;
  overall: CandidateRating | null;
  overall_note: string;
  ratings: Record<string, { rating?: CandidateRating | null; note?: string }>;
};

/** Reads a stored summary back, dropping anything malformed. */
export function readFeedbackSummary(value: unknown): FeedbackSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const quotes = (x: unknown): SummaryQuote[] =>
    Array.isArray(x)
      ? x
          .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
          .map((q) => ({
            scorecardId: str(q.scorecardId),
            author: str(q.author),
            interview: str(q.interview),
            quote: str(q.quote),
          }))
          .filter((q) => q.quote)
      : [];
  const points = (x: unknown): SummaryPoint[] =>
    Array.isArray(x)
      ? x
          .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
          .map((p) => ({ text: str(p.text), quotes: quotes(p.quotes) }))
          .filter((p) => p.text)
      : [];
  const disagreements: SummaryDisagreement[] = Array.isArray(v.disagreements)
    ? v.disagreements
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .map((p) => ({ competency: str(p.competency), text: str(p.text), quotes: quotes(p.quotes) }))
        .filter((p) => p.text && p.competency)
    : [];
  return { agreements: points(v.agreements), disagreements, concerns: points(v.concerns) };
}
