"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { deleteTemplate } from "@/helpers/pipeline/email-templates";

const inputSchema = z.object({ templateId: z.string().uuid() }).strict();

/**
 * SERVER ACTION: deletes one of the session company's own templates (never a
 * seeded default). The work is in `helpers/pipeline/email-templates.ts`,
 * shared with the agent.
 */
export async function deleteTemplateAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({ permission: "settings.templates" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Template not found." };

  return deleteTemplate(auth, parsed.data);
}
