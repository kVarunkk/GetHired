import { screenFairnessText } from "@/helpers/ai/fairness";
import type { InterviewConfig } from "./schemas";

export type ConfigFairnessResult = { ok: true } | { ok: false; error: string; field: string };

const CULTURE_FIT = /\bculture[\s-]*fit\b/i;

/**
 * SI-SEC-006: competencies and questions may not target a protected
 * characteristic or a proxy for one. Any mention counts (the strict
 * `candidate_filter` context), since the interview scores candidates on them.
 * "Culture fit" passes only with a job-related description. Client-safe, so
 * the config form shows the same error on the field.
 */
export function screenInterviewConfigFairness(
  config: Pick<InterviewConfig, "questions" | "competencies">,
): ConfigFairnessResult {
  for (const [i, competency] of config.competencies.entries()) {
    const name = screenFairnessText(competency.name, { context: "candidate_filter" });
    if (!name.ok) {
      return {
        ok: false,
        field: `competencies.${i}.name`,
        error: `Competencies can't be about ${name.term}. Change or remove "${competency.name}".`,
      };
    }
    const description = screenFairnessText(competency.description, { context: "candidate_filter" });
    if (!description.ok) {
      return {
        ok: false,
        field: `competencies.${i}.description`,
        error: `The description of "${competency.name}" can't mention ${description.term}.`,
      };
    }
    if (CULTURE_FIT.test(competency.name) && !competency.description.trim()) {
      return {
        ok: false,
        field: `competencies.${i}.description`,
        error: `"${competency.name}" needs a job-related description, e.g. "Gives and takes direct feedback in code reviews".`,
      };
    }
  }

  for (const [i, question] of config.questions.entries()) {
    const result = screenFairnessText(question.text, { context: "candidate_filter" });
    if (!result.ok) {
      return {
        ok: false,
        field: `questions.${i}.text`,
        error: `Interview questions can't ask about ${result.term}. Change or remove "${question.text}".`,
      };
    }
  }

  return { ok: true };
}
