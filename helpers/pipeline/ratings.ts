import type { Enums } from "@/utils/types/database.types";

export type CandidateRating = Enums<"candidate_rating">;

/** strong_no..strong_yes, for the average (PL-REQ-006). */
export const RATING_SCORE: Record<CandidateRating, number> = {
  strong_no: 1,
  no: 2,
  yes: 3,
  strong_yes: 4,
};

export const RATING_LABELS: Record<CandidateRating, string> = {
  strong_no: "Strong no",
  no: "No",
  yes: "Yes",
  strong_yes: "Strong yes",
};

export type RatingSummary = {
  /** Rated notes. */
  count: number;
  /** 1–4, or null with no ratings. */
  average: number | null;
  byRating: Record<CandidateRating, number>;
};

/** Client-safe, so the notes panel and the board can share it. */
export function ratingSummary(notes: { rating: CandidateRating | null }[]): RatingSummary {
  const byRating: Record<CandidateRating, number> = { strong_no: 0, no: 0, yes: 0, strong_yes: 0 };
  let total = 0;
  let count = 0;
  for (const { rating } of notes) {
    if (!rating) continue;
    byRating[rating] += 1;
    total += RATING_SCORE[rating];
    count += 1;
  }
  return { count, average: count > 0 ? total / count : null, byRating };
}
