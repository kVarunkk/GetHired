import { liveQuestions, type ApplicationForm } from "@/helpers/jobs/application-form-schema";

export type AnswerFilterQuestion = { id: string; label: string; options: { value: string; label: string }[] };

/** AF-REQ-008: the questions the applicants table can filter by (yes/no and single choice). */
export function answerFilterQuestions(form: ApplicationForm): AnswerFilterQuestion[] {
  return liveQuestions(form).flatMap((q) => {
    if (q.type === "yes_no") {
      return [{ id: q.id, label: q.label, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }];
    }
    if (q.type === "single_select") {
      return [{ id: q.id, label: q.label, options: (q.options ?? []).map((o) => ({ value: o, label: o })) }];
    }
    return [];
  });
}
