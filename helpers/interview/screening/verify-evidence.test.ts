import { describe, expect, it } from "vitest";
import type { ScreeningReport, TranscriptTurn } from "./schemas";
import { normalizeForQuote, verifyEvidence } from "./verify-evidence";

const turn = (turn_id: number, user: string, assistant: string | null = "Next question."): TranscriptTurn => ({
  turn_id,
  timestamp: 1_700_000_000 + turn_id,
  user,
  assistant,
  interrupted: false,
});

const turns: TranscriptTurn[] = [
  turn(0, "Hi, I'm ready.", "Tell me about a system you designed."),
  turn(1, "I built a payments API in Go. We sharded Postgres by merchant, and cut p99 latency to 40 ms."),
  turn(2, "Um, so, the trade-offs were mostly about consistency vs. availability.", "How did you handle retries?"),
];

const report = (competencies: ScreeningReport["competencies"]): ScreeningReport => ({
  competencies,
  questionCoverage: [],
  summary: "",
  strengths: [],
  concerns: [],
  followUpQuestions: [],
});

describe("normalizeForQuote", () => {
  it("ignores case, whitespace and punctuation", () => {
    expect(normalizeForQuote("  Trade-offs,   were  MOSTLY…  ")).toBe("trade offs were mostly");
    expect(normalizeForQuote("don’t")).toBe(normalizeForQuote("don't"));
  });
});

describe("verifyEvidence (SI-REQ-031, SI-TEST-007)", () => {
  it("keeps verbatim quotes", () => {
    const result = verifyEvidence(
      report([
        {
          name: "System design",
          score: 4,
          rationale: "r",
          evidence: [{ turnId: 1, quote: "We sharded Postgres by merchant" }],
        },
      ]),
      turns,
    );
    expect(result.competencies[0]).toMatchObject({
      score: 4,
      evidence: [{ turnId: 1, quote: "We sharded Postgres by merchant" }],
    });
  });

  it("matches across whitespace, case and punctuation differences", () => {
    const result = verifyEvidence(
      report([
        {
          name: "System design",
          score: 3,
          rationale: "r",
          evidence: [
            { turnId: 2, quote: "The trade offs were mostly about consistency versus" },
            { turnId: 2, quote: "TRADE-OFFS   were mostly about consistency vs availability" },
          ],
        },
      ]),
      turns,
    );
    // "versus" isn't in the turn; the second quote only differs in case, spacing and punctuation.
    expect(result.competencies[0].evidence).toEqual([
      { turnId: 2, quote: "TRADE-OFFS   were mostly about consistency vs availability" },
    ]);
    expect(result.competencies[0].score).toBe(3);
  });

  it("drops a fabricated quote", () => {
    const result = verifyEvidence(
      report([
        {
          name: "System design",
          score: 5,
          rationale: "r",
          evidence: [
            { turnId: 1, quote: "I led a team of twenty engineers" },
            { turnId: 1, quote: "cut p99 latency to 40 ms" },
          ],
        },
      ]),
      turns,
    );
    expect(result.competencies[0].evidence).toEqual([{ turnId: 1, quote: "cut p99 latency to 40 ms" }]);
  });

  it("rejects a quote from the interviewer's text", () => {
    const result = verifyEvidence(
      report([
        {
          name: "System design",
          score: 4,
          rationale: "r",
          evidence: [{ turnId: 0, quote: "Tell me about a system you designed" }],
        },
      ]),
      turns,
    );
    expect(result.competencies[0].evidence).toEqual([]);
  });

  it("rejects an unknown turnId, and a quote attributed to the wrong turn", () => {
    const result = verifyEvidence(
      report([
        {
          name: "System design",
          score: 4,
          rationale: "r",
          evidence: [
            { turnId: 9, quote: "We sharded Postgres" },
            { turnId: 2, quote: "We sharded Postgres" },
          ],
        },
      ]),
      turns,
    );
    expect(result.competencies[0].evidence).toEqual([]);
  });

  it("rejects a quote that is only punctuation", () => {
    const result = verifyEvidence(
      report([{ name: "System design", score: 2, rationale: "r", evidence: [{ turnId: 1, quote: "..." }] }]),
      turns,
    );
    expect(result.competencies[0].evidence).toEqual([]);
  });

  it("nulls a score left with no evidence, and keeps unscored competencies as they are", () => {
    const result = verifyEvidence(
      report([
        {
          name: "System design",
          score: 5,
          rationale: "r",
          evidence: [{ turnId: 1, quote: "I invented Kubernetes" }],
        },
        { name: "Communication", score: null, rationale: "Not covered.", evidence: [] },
      ]),
      turns,
    );
    expect(result.competencies.map((c) => c.score)).toEqual([null, null]);
    expect(result.competencies[1]).toEqual({ name: "Communication", score: null, rationale: "Not covered.", evidence: [] });
  });

  it("nulls a question-coverage turn that doesn't exist", () => {
    const result = verifyEvidence(
      {
        ...report([]),
        questionCoverage: [
          { question: "Tell me about a system you designed.", asked: true, turnId: 0 },
          { question: "Why this role?", asked: true, turnId: 42 },
        ],
      },
      turns,
    );
    expect(result.questionCoverage.map((q) => q.turnId)).toEqual([0, null]);
  });
});
