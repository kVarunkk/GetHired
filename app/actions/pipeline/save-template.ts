"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  TEMPLATE_FIELDS_ERROR,
  templateFields,
  unknownVariablesRefusal,
} from "@/helpers/pipeline/template-input";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z.object({ templateId: z.string().uuid(), ...templateFields }).strict();

/**
 * SERVER ACTION (PL-TASK-032, PL-REQ-007): saves one of the session company's
 * email templates. A template with an unknown `{{variable}}` isn't saved, so
 * every send can render it.
 */
export async function saveTemplateAction(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true } | { ok: false; error: string; unknownVariables?: string[] }> {
  const auth = await requireCompanyForAction({ permission: "settings.templates" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: TEMPLATE_FIELDS_ERROR };
  const { templateId, name, subject, body } = parsed.data;

  const refusal = unknownVariablesRefusal(subject, body);
  if (refusal) return refusal;

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
