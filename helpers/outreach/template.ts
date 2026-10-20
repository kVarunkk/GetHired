import { renderTemplate, type TemplateVariable, type TemplateVars } from "@/helpers/pipeline/templates";

// Difference 12: outreach uses the pipeline's `custom` templates, but an
// outreach has no application. The composer fills the candidate's first name
// and the chosen job's title, and the message is plain text (OR-SEC-002), so
// the markdown escaping renderTemplate adds for emails is undone.

const ESCAPED = /\\([\\`*_{}[\]()#+\-.!<>|~&])/g;
const AUTOLINK = /<(https:\/\/[^\s<>]+)>/g;

export type OutreachTemplateResult =
  | { ok: true; subject: string; message: string; missing: TemplateVariable[] }
  | { ok: false; error: string };

export function renderOutreachTemplate(
  template: { subject: string; body_md: string },
  vars: TemplateVars,
): OutreachTemplateResult {
  const result = renderTemplate(template, vars);
  if (!result.ok) return result;
  return {
    ok: true,
    subject: result.subject,
    message: result.body.replace(AUTOLINK, "$1").replace(ESCAPED, "$1"),
    missing: result.missingVariables,
  };
}
