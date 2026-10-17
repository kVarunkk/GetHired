import { z } from "zod";
import {
  MAX_TEMPLATE_BODY,
  MAX_TEMPLATE_NAME,
  MAX_TEMPLATE_SUBJECT,
  TEMPLATE_VARIABLES,
  renderTemplate,
  type TemplateVars,
} from "@/helpers/pipeline/templates";

/** The editable fields of a template, shared by the save and create actions. */
export const templateFields = {
  name: z.string().trim().min(1).max(MAX_TEMPLATE_NAME),
  subject: z.string().trim().min(1).max(MAX_TEMPLATE_SUBJECT),
  body: z.string().trim().min(1).max(MAX_TEMPLATE_BODY),
};

export const TEMPLATE_FIELDS_ERROR = `Names are 1 to ${MAX_TEMPLATE_NAME} characters, subjects 1 to ${MAX_TEMPLATE_SUBJECT} and messages 1 to 5,000.`;

const PLACEHOLDERS = Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v, v])) as TemplateVars;

/**
 * Refuses a template with an unknown `{{variable}}`, so every send can render
 * it. Returns null when the template is fine.
 */
export function unknownVariablesRefusal(
  subject: string,
  body: string,
): { ok: false; error: string; unknownVariables: string[] } | null {
  const rendered = renderTemplate({ subject, body_md: body }, PLACEHOLDERS);
  if (!rendered.ok || rendered.unknownVariables.length === 0) return null;
  const list = rendered.unknownVariables.map((v) => `{{${v}}}`).join(", ");
  return { ok: false, error: `Remove or fix ${list}.`, unknownVariables: rendered.unknownVariables };
}
