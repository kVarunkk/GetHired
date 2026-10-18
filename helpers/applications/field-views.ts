import {
  LONG_TEXT_MAX,
  SHORT_TEXT_MAX,
  STANDARD_FIELDS,
  type ApplicationForm,
  type StandardFieldKey,
  type StandardFieldKind,
} from "@/helpers/jobs/application-form-schema";
import { fieldsOf } from "./validate-answers";

/** A field as shown to people: a form question or a standard field, with its label. */
export type FieldView = {
  key: string;
  kind: StandardFieldKind;
  label: string;
  help?: string;
  required: boolean;
  options?: string[];
  min?: number;
  max?: number;
  maxLength?: number;
};

/** The fields `form` asks for, in display order: the questions, then the standard fields. */
export function fieldViews(form: ApplicationForm): FieldView[] {
  const questions = new Map(form.questions.map((q) => [q.id, q]));
  return fieldsOf(form).map((field) => {
    const q = questions.get(field.key);
    if (q) {
      return {
        key: q.id,
        kind: q.type,
        label: q.label,
        help: q.help_text,
        required: q.required,
        options: q.options,
        min: q.min,
        max: q.max,
        maxLength:
          q.max_length ?? (q.type === "long_text" ? LONG_TEXT_MAX : q.type === "short_text" ? SHORT_TEXT_MAX : undefined),
      };
    }
    const std = STANDARD_FIELDS[field.key.slice("std:".length) as StandardFieldKey];
    return { key: field.key, kind: field.kind, label: std.label, required: field.required };
  });
}
