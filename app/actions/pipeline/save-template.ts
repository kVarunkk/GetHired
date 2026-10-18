"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { saveTemplate } from "@/helpers/pipeline/email-templates";
import { TEMPLATE_FIELDS_ERROR, templateFields } from "@/helpers/pipeline/template-input";

const inputSchema = z.object({ templateId: z.string().uuid(), ...templateFields }).strict();

/**
 * SERVER ACTION (PL-TASK-032, PL-REQ-007): saves one of the session company's
 * email templates. The work is in `helpers/pipeline/email-templates.ts`,
 * shared with the agent.
 */
export async function saveTemplateAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string; unknownVariables?: string[] }> {
  const auth = await requireCompanyForAction({ permission: "settings.templates" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: TEMPLATE_FIELDS_ERROR };

  const result = await saveTemplate(auth, parsed.data, { source: "manual" });
  return result.ok ? { ok: true } : result;
}
