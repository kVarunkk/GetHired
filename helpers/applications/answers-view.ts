import {
  applicationFormSchema,
  legacyQuestionId,
  type StandardFieldKind,
} from "@/helpers/jobs/application-form-schema";
import { fieldViews } from "./field-views";

// AF-REQ-005/008: an application's answers as label → text, for the company
// pages, the screening input and the recruiter agent. Uses the form snapshot
// the candidate answered; old applications fall back to the job's questions.
// Values are plain text, never HTML (AF-SEC-002).

export type AnswerView = {
  key: string;
  label: string;
  type: StandardFieldKind;
  /** The answer as text, or null when it was skipped. */
  text: string | null;
  /** A safe http(s) link for URL answers. */
  url: string | null;
};

type ApplicationAnswers = {
  answers?: string[] | null;
  answers_v2?: unknown;
  form_snapshot?: unknown;
};

export function safeAnswerUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function asText(type: StandardFieldKind, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  switch (type) {
    case "yes_no":
      return value === true ? "Yes" : value === false ? "No" : null;
    case "multi_select":
      return Array.isArray(value) && value.length > 0 ? value.map(String).join(", ") : null;
    case "number":
      return typeof value === "number" ? value.toLocaleString("en-US") : null;
    case "salary": {
      const { amount, currency } = (value ?? {}) as { amount?: unknown; currency?: unknown };
      return typeof amount === "number" && typeof currency === "string" ? `${amount.toLocaleString("en-US")} ${currency}` : null;
    }
    default:
      return typeof value === "string" ? value.trim() || null : null;
  }
}

export function answersView(application: ApplicationAnswers, legacyQuestions: readonly string[] | null | undefined): AnswerView[] {
  const snapshot = applicationFormSchema.safeParse(application.form_snapshot);
  const typed = application.answers_v2;
  if (snapshot.success && typed && typeof typed === "object" && !Array.isArray(typed)) {
    const values = typed as Record<string, unknown>;
    return fieldViews(snapshot.data).map((field) => {
      const text = asText(field.kind, values[field.key]);
      return {
        key: field.key,
        label: field.label,
        type: field.kind,
        text,
        url: field.kind === "url" && text ? safeAnswerUrl(text) : null,
      };
    });
  }

  return (legacyQuestions ?? []).map((label, i) => ({
    key: legacyQuestionId(i),
    label,
    type: "long_text" as const,
    text: application.answers?.[i]?.trim() || null,
    url: null,
  }));
}
