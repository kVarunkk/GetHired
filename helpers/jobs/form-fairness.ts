import { screenFairnessText } from "@/helpers/ai/fairness";
import { liveQuestions, type ApplicationForm } from "./application-form-schema";

/**
 * AF-SEC-001: an application question may not ask about a protected
 * characteristic. Any mention counts (the strict `candidate_filter` context),
 * since a question is asking for it. Checks labels, help text and options.
 */
export function screenFormFairness(form: ApplicationForm): { ok: true } | { ok: false; error: string; questionId: string } {
  for (const q of liveQuestions(form)) {
    for (const text of [q.label, q.help_text ?? "", ...(q.options ?? [])]) {
      const result = screenFairnessText(text, { context: "candidate_filter" });
      if (!result.ok) {
        return {
          ok: false,
          questionId: q.id,
          error: `Application questions can't ask about ${result.term}. Change or remove "${q.label}".`,
        };
      }
    }
  }
  return { ok: true };
}
