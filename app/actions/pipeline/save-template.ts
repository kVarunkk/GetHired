"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  MAX_TEMPLATE_BODY,
  MAX_TEMPLATE_SUBJECT,
  TEMPLATE_VARIABLES,
  renderTemplate,
  type TemplateVars,
} from "@/helpers/pipeline/templates";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z
  .object({
    templateId: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    subject: z.string().trim().min(1).max(MAX_TEMPLATE_SUBJECT),
    body: z.string().trim().min(1).max(MAX_TEMPLATE_BODY),
  })
  .strict();

const PLACEHOLDERS = Object.fromEntries(TEMPLATE_VARIABLES.map((v) => [v, v])) as TemplateVars;

/**
 * SERVER ACTION (PL-TASK-032, PL-REQ-007): saves one of the session company's
 * email templates. A template with an unknown `{{variable}}` isn't saved, so
 * every send can render it.
 */
export async function saveTemplateAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string; unknownVariables?: string[] }> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Names are 1 to 60 characters, subjects 1 to ${MAX_TEMPLATE_SUBJECT} and messages 1 to 5,000.`,
    };
  }
  const { templateId, name, subject, body } = parsed.data;

  const rendered = renderTemplate({ subject, body_md: body }, PLACEHOLDERS);
  if (rendered.ok && rendered.unknownVariables.length > 0) {
    const list = rendered.unknownVariables.map((v) => `{{${v}}}`).join(", ");
    return { ok: false, error: `Remove or fix ${list}.`, unknownVariables: rendered.unknownVariables };
  }

  const { data, error } = await auth.supabase
    .from("company_email_templates")
    .update({ name, subject, body_md: body, updated_at: new Date().toISOString() })
    .eq("id", templateId)
    .eq("company_id", auth.company.id)
    .select("id, purpose")
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't save the template. Please try again." };
  if (!data) return { ok: false, error: "Template not found." };

  revalidatePath("/company/settings");
  await eventCaptureServer({
    event: PostHogEvent.PipelineTemplateSaved,
    distinctId: auth.user.id,
    properties: { purpose: data.purpose },
  });
  return { ok: true };
}
