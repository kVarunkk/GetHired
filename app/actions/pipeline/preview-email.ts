"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { actorName } from "@/helpers/pipeline/move";
import {
  MAX_TEMPLATE_BODY,
  MAX_TEMPLATE_SUBJECT,
  renderTemplate,
  type TemplateVariable,
} from "@/helpers/pipeline/templates";

const inputSchema = z
  .object({
    /** The first selected application: its candidate's real values fill the preview. */
    applicationId: z.string().uuid(),
    subject: z.string().max(MAX_TEMPLATE_SUBJECT * 2),
    body: z.string().max(MAX_TEMPLATE_BODY * 2),
  })
  .strict();

export type PreviewEmailResult =
  | {
      ok: true;
      subject: string;
      /** Markdown. */
      body: string;
      unknownVariables: string[];
      missingVariables: TemplateVariable[];
    }
  | { ok: false; error: string };

/**
 * SERVER ACTION (PL-TASK-031): renders a move email for one of the company's
 * applications, exactly as `moveApplications` would. Sends nothing.
 */
export async function previewEmailAction(
  input: z.input<typeof inputSchema>,
): Promise<PreviewEmailResult> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Couldn't preview this email." };
  const { applicationId, subject, body } = parsed.data;
  const { supabase, company, user } = auth;

  const [{ data: app }, { data: settings }] = await Promise.all([
    supabase
      .from("applications")
      .select("id, user_info(full_name), job_postings!inner(title, company_id)")
      .eq("id", applicationId)
      .eq("job_postings.company_id", company.id)
      .maybeSingle(),
    supabase.from("company_info").select("name, scheduling_url").eq("id", company.id).maybeSingle(),
  ]);
  if (!app) return { ok: false, error: "Application not found." };

  return renderTemplate(
    { subject, body_md: body },
    {
      candidate_first_name: app.user_info?.full_name?.trim().split(/\s+/)[0] || null,
      job_title: app.job_postings.title,
      company_name: settings?.name ?? company.name,
      scheduling_link: settings?.scheduling_url ?? null,
      sender_name: actorName(user, company),
    },
  );
}
