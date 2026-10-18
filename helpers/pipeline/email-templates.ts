import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";
import type { Database } from "@/utils/types/database.types";
import { unknownVariablesRefusal } from "./template-input";
import { MAX_TEMPLATES_PER_COMPANY, type TemplatePurpose } from "./templates";

type Ctx = { supabase: SupabaseClient<Database>; company: MyCompany; user: Pick<User, "id"> };
/** Who made the change, for analytics. */
type Source = "manual" | "agent";
type Refusal = { ok: false; error: string; unknownVariables?: string[] };

export type EmailTemplate = {
  id: string;
  purpose: string;
  name: string;
  subject: string;
  body_md: string;
  is_default: boolean;
};

const COLUMNS = "id, purpose, name, subject, body_md, is_default";
const NOT_FOUND = { ok: false, error: "Template not found." } as const;

/** The session company's templates, by purpose. Throws on a database error. */
export async function listTemplates({ supabase, company }: Pick<Ctx, "supabase" | "company">): Promise<EmailTemplate[]> {
  const { data, error } = await supabase
    .from("company_email_templates")
    .select(COLUMNS)
    .eq("company_id", company.id)
    .order("purpose", { ascending: true });
  if (error) throw new Error(`Failed to load the email templates: ${error.message}`);
  return data ?? [];
}

/**
 * Adds a template next to the seeded one for its purpose. It's never the
 * default: the seeded template stays preselected, and the new one is offered
 * alongside it. Fields are already validated (`templateFields`); the caller
 * checks settings.templates.
 */
export async function createTemplate(
  { supabase, company, user }: Ctx,
  { purpose, name, subject, body }: { purpose: TemplatePurpose; name: string; subject: string; body: string },
  { source }: { source: Source },
): Promise<{ ok: true; template: EmailTemplate } | Refusal> {
  const refusal = unknownVariablesRefusal(subject, body);
  if (refusal) return refusal;

  const { count, error: countError } = await supabase
    .from("company_email_templates")
    .select("id", { count: "exact", head: true })
    .eq("company_id", company.id);
  if (countError) return { ok: false, error: "Couldn't add the template. Please try again." };
  if ((count ?? 0) >= MAX_TEMPLATES_PER_COMPANY) {
    return {
      ok: false,
      error: `You can have up to ${MAX_TEMPLATES_PER_COMPANY} templates. Delete one to add another.`,
    };
  }

  const { data, error } = await supabase
    .from("company_email_templates")
    .insert({ company_id: company.id, purpose, name, subject, body_md: body, is_default: false })
    .select(COLUMNS)
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add the template. Please try again." };

  revalidatePath("/company/settings");
  await eventCaptureServer({
    event: PostHogEvent.PipelineTemplateSaved,
    distinctId: user.id,
    properties: { purpose, created: true, source },
  });
  return { ok: true, template: data };
}

/**
 * Saves one of the company's templates. A field left out keeps its current
 * value. A template with an unknown `{{variable}}` isn't saved, so every send
 * can render it.
 */
export async function saveTemplate(
  { supabase, company, user }: Ctx,
  { templateId, ...change }: { templateId: string; name?: string; subject?: string; body?: string },
  { source }: { source: Source },
): Promise<{ ok: true; purpose: string } | Refusal> {
  if (!isUuid(templateId)) return NOT_FOUND;

  let { name, subject, body } = change;
  if (name === undefined || subject === undefined || body === undefined) {
    const { data: current, error } = await supabase
      .from("company_email_templates")
      .select("name, subject, body_md")
      .eq("id", templateId)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) return { ok: false, error: "Couldn't save the template. Please try again." };
    if (!current) return NOT_FOUND;
    name ??= current.name;
    subject ??= current.subject;
    body ??= current.body_md;
  }

  const refusal = unknownVariablesRefusal(subject, body);
  if (refusal) return refusal;

  const { data, error } = await supabase
    .from("company_email_templates")
    .update({ name, subject, body_md: body, updated_at: new Date().toISOString() })
    .eq("id", templateId)
    .eq("company_id", company.id)
    .select("id, purpose")
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't save the template. Please try again." };
  if (!data) return NOT_FOUND;

  revalidatePath("/company/settings");
  await eventCaptureServer({
    event: PostHogEvent.PipelineTemplateSaved,
    distinctId: user.id,
    properties: { purpose: data.purpose, source },
  });
  return { ok: true, purpose: data.purpose };
}

/**
 * Deletes one of the company's own templates. The seeded default of each
 * purpose can be edited but not deleted, so every move always has a template
 * to offer.
 */
export async function deleteTemplate(
  { supabase, company }: Pick<Ctx, "supabase" | "company">,
  { templateId }: { templateId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isUuid(templateId)) return NOT_FOUND;

  const { data, error } = await supabase
    .from("company_email_templates")
    .delete()
    .eq("id", templateId)
    .eq("company_id", company.id)
    .eq("is_default", false)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't delete the template. Please try again." };
  if (!data) return { ok: false, error: "Template not found, or it's a default template." };

  revalidatePath("/company/settings");
  return { ok: true };
}
