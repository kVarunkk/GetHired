import { describe, expect, it } from "vitest";
import { screeningResultOf } from "@/test/utils/matching";
import { SCREENING_LIMITS, recommendationFor } from "./config";
import { normaliseScreening } from "./normalise";

const THREE_QUESTIONS = 3;

describe("recommendationFor (MT-GUD-001)", () => {
  it.each([
    [100, "strong_yes"],
    [90, "strong_yes"],
    [89, "yes"],
    [75, "yes"],
    [74, "maybe"],
    [60, "maybe"],
    [59, "no"],
    [0, "no"],
  ] as const)("%s → %s", (score, recommendation) => {
    expect(recommendationFor(score)).toBe(recommendation);
  });
});

describe("normaliseScreening (MTT-062)", () => {
  it("leaves a consistent result alone", () => {
    expect(normaliseScreening(screeningResultOf(), THREE_QUESTIONS)).toEqual(screeningResultOf());
  });

  it.each([
    [140, 100],
    [-5, 0],
    [82.6, 83],
  ])("clamps and rounds fit_score %s to %s", (raw, expected) => {
    const result = normaliseScreening(screeningResultOf({ fit_score: raw }), THREE_QUESTIONS);

    expect(result.fit_score).toBe(expected);
  });

  it.each([
    [95, "no", "strong_yes"],
    [82, "strong_yes", "yes"],
    [65, "yes", "maybe"],
    [30, "maybe", "no"],
  ] as const)("replaces a recommendation that disagrees with the band (%s, %s → %s)", (score, given, expected) => {
    const result = normaliseScreening(
      screeningResultOf({ fit_score: score, recommendation: given }),
      THREE_QUESTIONS,
    );

    expect(result.recommendation).toBe(expected);
  });

  it("trims arrays and strings to their caps", () => {
    const many = Array.from({ length: 12 }, (_, i) => `item ${i}`);
    const result = normaliseScreening(
      screeningResultOf({
        summary: "s".repeat(500),
        strengths: many,
        gaps: many,
        must_have_coverage: many.map((requirement) => ({
          requirement,
          met: "yes" as const,
          evidence: "e".repeat(300),
        })),
        flags: ["salary expectation above range", "notice period is 90 days", "no testing evidence", "extra"],
      }),
      THREE_QUESTIONS,
    );

    expect(result.summary).toHaveLength(SCREENING_LIMITS.summaryChars);
    expect(result.strengths).toHaveLength(SCREENING_LIMITS.strengths);
    expect(result.gaps).toHaveLength(SCREENING_LIMITS.gaps);
    expect(result.must_have_coverage).toHaveLength(SCREENING_LIMITS.mustHaves);
    expect(result.must_have_coverage[0].evidence).toHaveLength(SCREENING_LIMITS.evidenceChars);
    expect(result.flags).toEqual([
      "salary expectation above range",
      "notice period is 90 days",
      "no testing evidence",
    ]);
  });

  it("drops blank items", () => {
    const result = normaliseScreening(
      screeningResultOf({ strengths: [" React ", "", "  "], flags: ["", " late "] }),
      THREE_QUESTIONS,
    );

    expect(result.strengths).toEqual(["React"]);
    expect(result.flags).toEqual(["late"]);
  });

  it("drops answer feedback with an out-of-range or repeated question_index", () => {
    const result = normaliseScreening(
      screeningResultOf({
        answer_feedback: [
          { question_index: 0, quality: "strong", note: "Good." },
          { question_index: 0, quality: "weak", note: "Duplicate." },
          { question_index: 1, quality: "ok", note: "Fine." },
          { question_index: 2, quality: "missing", note: "None." },
          { question_index: 3, quality: "strong", note: "No such question." },
          { question_index: -1, quality: "strong", note: "Negative." },
          { question_index: 1.5, quality: "strong", note: "Not an index." },
        ],
      }),
      THREE_QUESTIONS,
    );

    expect(result.answer_feedback).toEqual([
      { question_index: 0, quality: "strong", note: "Good." },
      { question_index: 1, quality: "ok", note: "Fine." },
      { question_index: 2, quality: "missing", note: "None." },
    ]);
  });

  it("adds a missing entry for each question the model skipped, in order", () => {
    const result = normaliseScreening(
      screeningResultOf({
        answer_feedback: [{ question_index: 1, quality: "ok", note: "Fine." }],
      }),
      THREE_QUESTIONS,
    );

    expect(result.answer_feedback.map((f) => [f.question_index, f.quality])).toEqual([
      [0, "missing"],
      [1, "ok"],
      [2, "missing"],
    ]);
  });

  it("caps the note length", () => {
    const result = normaliseScreening(
      screeningResultOf({
        answer_feedback: [{ question_index: 0, quality: "ok", note: "n".repeat(400) }],
      }),
      1,
    );

    expect(result.answer_feedback[0].note).toHaveLength(SCREENING_LIMITS.noteChars);
  });

  it("has no answer feedback for a job without questions", () => {
    expect(normaliseScreening(screeningResultOf(), 0).answer_feedback).toEqual([]);
  });
});
