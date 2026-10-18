import type { ScreeningReport, TranscriptTurn } from "./schemas";

/**
 * The form a quote is compared in: case, whitespace and punctuation don't
 * count, so "Trade-offs, were" matches "trade offs were". Apostrophes are
 * dropped rather than spaced, so "don't" stays one word.
 */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’ʼ`]/g, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keeps only the evidence the transcript backs (SI-REQ-031, SI-SEC-005): a
 * quote must be whole words of the candidate's own text in the turn it names,
 * never the interviewer's. A score left with no evidence becomes null ("not
 * assessed"), and a question-coverage turn that doesn't exist becomes null.
 */
export function verifyEvidence(report: ScreeningReport, turns: TranscriptTurn[]): ScreeningReport {
  // Padded with spaces so a match always starts and ends on a word boundary.
  const candidateText = new Map(turns.map((t) => [t.turn_id, ` ${normalizeForQuote(t.user)} `]));

  const competencies = report.competencies.map((competency) => {
    const evidence = competency.evidence.filter(({ turnId, quote }) => {
      const said = candidateText.get(turnId);
      const wanted = normalizeForQuote(quote);
      return !!said && !!wanted && said.includes(` ${wanted} `);
    });
    return { ...competency, evidence, score: evidence.length > 0 ? competency.score : null };
  });

  const questionCoverage = report.questionCoverage.map((item) => ({
    ...item,
    turnId: item.turnId !== null && candidateText.has(item.turnId) ? item.turnId : null,
  }));

  return { ...report, competencies, questionCoverage };
}
