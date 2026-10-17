"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  TEMPLATE_FIELDS_ERROR,
  templateFields,
  unknownVariablesRefusal,
} from "@/helpers/pipeline/template-input";
import { MAX_TEMPLATES_PER_COMPANY, TEMPLATE_PURPOSES } from "@/helpers/pipeline/templates";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

const inputSchema = z.object({ purpose: z.enum(TEMPLATE_PURPOSES), ...templateFields }).strict();

export type CreatedTemplate = {
  id: string;
  purpose: string;
  name: string;
  subject: string;
  body_md: string;
  is_default: boolean;
};

/**
 * SERVER ACTION: adds an email template for the session company, next to the
 * seeded one for its purpose. It's never the default: the seeded template
 * stays preselected, and the new one is offered alongside it.
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
  const { purpose, name, subject, body } = parsed.data;

  const refusal = unknownVariablesRefusal(subject, body);
  if (refusal) return refusal;

  const { count, error: countError } = await auth.supabase
    .from("company_email_templates")
    .select("id", { count: "exact", head: true })
    .eq("company_id", auth.company.id);
  if (countError) return { ok: false, error: "Couldn't add the template. Please try again." };
  if ((count ?? 0) >= MAX_TEMPLATES_PER_COMPANY) {
    return {
      ok: false,
      error: `You can have up to ${MAX_TEMPLATES_PER_COMPANY} templates. Delete one to add another.`,
    };
  }

  const { data, error } = await auth.supabase
    .from("company_email_templates")
    .insert({ company_id: auth.company.id, purpose, name, subject, body_md: body, is_default: false })
    .select("id, purpose, name, subject, body_md, is_default")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add the template. Please try again." };

  revalidatePath("/company/settings");
  await eventCaptureServer({
    event: PostHogEvent.PipelineTemplateSaved,
    distinctId: auth.user.id,
    properties: { purpose, created: true },
  });
  return { ok: true, template: data };
}
