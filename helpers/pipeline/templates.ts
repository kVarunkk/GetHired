/**
 * Email template rendering (PL-TASK-030, PL-SEC-003): a whitelist `{{var}}`
 * substitution. No eval and no template engine. Client-safe, so the template
 * editor's live preview uses the same code as the send.
 */

export const TEMPLATE_VARIABLES = [
  "candidate_first_name",
  "job_title",
  "company_name",
  "scheduling_link",
  "sender_name",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Record<TemplateVariable, string | null | undefined>;

export const TEMPLATE_PURPOSES = ["rejection", "advance", "interview_invite", "offer", "custom"] as const;
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number];

export const MAX_TEMPLATE_SUBJECT = 150;
export const MAX_TEMPLATE_BODY = 5000;

// A Map, so `constructor`, `__proto__` and friends are never "known".
const KNOWN = new Map<string, TemplateVariable>(TEMPLATE_VARIABLES.map((v) => [v, v]));
const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

// Every markdown (and HTML) metacharacter, so a value always renders as text.
const MARKDOWN_SPECIAL = /[\\`*_{}[\]()#+\-.!<>|~&]/g;
const escapeMarkdown = (value: string) => value.replace(MARKDOWN_SPECIAL, "\\$&");
// The scheduling link stays clickable as an autolink when it's a plain https URL.
const HTTPS_URL = /^https:\/\/[^\s<>]+$/;
const bodyValue = (name: TemplateVariable, value: string) =>
  name === "scheduling_link" && HTTPS_URL.test(value) ? `<${value}>` : escapeMarkdown(value);
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ");

export type RenderResult =
  | {
      ok: true;
      subject: string;
      /** Markdown. */
      body: string;
      /** `{{name}}`s that aren't variables, left visible. */
      unknownVariables: string[];
      /** Known variables with no value (e.g. no scheduling link), left visible. */
      missingVariables: TemplateVariable[];
    }
  | { ok: false; error: string };

function substitute(
  text: string,
  vars: TemplateVars,
  encode: (name: TemplateVariable, value: string) => string,
  unknown: Set<string>,
  missing: Set<TemplateVariable>,
): string {
  // One pass: a value is never scanned for variables again.
  return text.replace(VARIABLE, (match, name: string) => {
    const known = KNOWN.get(name);
    if (!known) {
      unknown.add(name);
      return match;
    }
    const value = vars[known];
    if (value === null || value === undefined || value.trim() === "") {
      missing.add(known);
      return match;
    }
    return encode(known, value);
  });
}

export function renderTemplate(
  template: { subject: string; body_md: string },
  vars: TemplateVars,
): RenderResult {
  if (!template.subject.trim()) return { ok: false, error: "Add a subject." };
  if (!template.body_md.trim()) return { ok: false, error: "Add a message." };

  const unknown = new Set<string>();
  const missing = new Set<TemplateVariable>();
  const subject = oneLine(substitute(template.subject, vars, (_, v) => oneLine(v), unknown, missing)).trim();
  const body = substitute(template.body_md, vars, bodyValue, unknown, missing);

  if (subject.length > MAX_TEMPLATE_SUBJECT) {
    return { ok: false, error: `The subject is over ${MAX_TEMPLATE_SUBJECT} characters.` };
  }
  if (body.length > MAX_TEMPLATE_BODY) {
    return { ok: false, error: "The message is over 5,000 characters." };
  }

  return {
    ok: true,
    subject,
    body,
    unknownVariables: [...unknown],
    missingVariables: [...missing],
  };
}

/** The purpose whose templates suit a move to a stage of this kind (PLT-063). */
export function purposeForKind(kind: string): TemplatePurpose {
  switch (kind) {
    case "rejected":
      return "rejection";
    case "interview":
      return "interview_invite";
    case "offer":
      return "offer";
    default:
      return "advance";
  }
}
