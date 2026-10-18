"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { createTemplate, type EmailTemplate } from "@/helpers/pipeline/email-templates";
import { TEMPLATE_FIELDS_ERROR, templateFields } from "@/helpers/pipeline/template-input";
import { TEMPLATE_PURPOSES } from "@/helpers/pipeline/templates";

const inputSchema = z.object({ purpose: z.enum(TEMPLATE_PURPOSES), ...templateFields }).strict();

export type CreatedTemplate = EmailTemplate;

/**
 * SERVER ACTION: adds an email template for the session company, next to the
 * seeded one for its purpose. The work is in `helpers/pipeline/email-templates.ts`,
 * shared with the agent.
 */
export async function createTemplateAction(
  input: z.input<typeof inputSchema>,
): Promise<
  { ok: true; template: CreatedTemplate } | { ok: false; error: string; unknownVariables?: string[] }
> {
  const auth = await requireCompanyForAction({ permission: "settings.templates" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: TEMPLATE_FIELDS_ERROR };

  return createTemplate(auth, parsed.data, { source: "manual" });
}
