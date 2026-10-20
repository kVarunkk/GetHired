import {
  QUESTION_TYPE_LABELS,
  STANDARD_FIELDS,
  STANDARD_FIELD_KEYS,
  applicationFormSchema,
} from "./application-form-schema";

/**
 * A drafted form as one line per question for the agent's approval card
 * (AF-REQ-009): "Can you relocate? (Yes / no, required, knockout: flag)".
 */
export function describeApplicationForm(value: unknown): string {
  const parsed = applicationFormSchema.safeParse(value);
  if (!parsed.success) return "An application form that doesn't validate yet.";
  const form = parsed.data;
  const lines = form.questions
    .filter((q) => !q.archived)
    .map((q) => {
      const notes = [QUESTION_TYPE_LABELS[q.type], q.required ? "required" : "optional"];
      if (q.knockout) notes.push(`knockout: ${q.knockout.action}`);
      return `${q.label} (${notes.join(", ")})`;
    });
  const standard = STANDARD_FIELD_KEYS.filter((k) => form.standard_fields[k] && form.standard_fields[k] !== "off").map(
    (k) => `${STANDARD_FIELDS[k].label} (${form.standard_fields[k]})`,
  );
  if (standard.length) lines.push(`Standard fields: ${standard.join(", ")}`);
  return lines.length ? lines.join("\n") : "No questions.";
}
