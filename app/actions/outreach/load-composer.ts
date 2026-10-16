"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { outreachStatusFor, type OutreachBadge } from "@/helpers/outreach/list";
import { firstName } from "@/helpers/outreach/linkify";
import { loadVisibleCandidates } from "@/helpers/profiles/visible-candidates";

const inputSchema = z.object({ candidateId: z.string().uuid() }).strict();

export type ComposerTemplate = { id: string; name: string; subject: string; body_md: string };

export type ComposerContext = {
  candidateFirstName: string | null;
  acceptsOutreach: boolean;
  /** The company's active jobs, for the job picker. */
  jobs: { id: string; title: string }[];
  /** Pipeline templates with purpose `custom` (OR-REQ-001). */
  templates: ComposerTemplate[];
  /** This month's outreach allowance; `remaining: null` is unlimited. */
  quota: { remaining: number | null; amount: number | null } | null;
  companyName: string | null;
  schedulingLink: string | null;
  senderName: string | null;
  latest: OutreachBadge | null;
};

export type LoadComposerResult = ({ ok: true } & ComposerContext) | { ok: false; error: string };

/**
 * SERVER ACTION: what the outreach composer needs about one candidate the
 * session company can see. Directory columns only: no contact details.
 */
export async function loadOutreachComposerAction(
  input: z.input<typeof inputSchema>,
): Promise<LoadComposerResult> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Candidate not found." };
  const { candidateId } = parsed.data;
  const { supabase, company, user } = auth;

  const candidates = await loadVisibleCandidates<{
    user_id: string | null;
    full_name: string | null;
    accepts_outreach: boolean | null;
  }>(supabase, [candidateId], "user_id, full_name, accepts_outreach");
  const candidate = candidates.get(candidateId);
  if (!candidate) return { ok: false, error: "Candidate not found." };

  const [jobs, templates, companyRow, latest, quota] = await Promise.all([
    supabase
      .from("job_postings")
      .select("id, title")
      .eq("company_id", company.id)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    supabase
      .from("company_email_templates")
      .select("id, name, subject, body_md")
      .eq("company_id", company.id)
      .eq("purpose", "custom")
      .order("name"),
    supabase.from("company_info").select("scheduling_url").eq("id", company.id).maybeSingle(),
    outreachStatusFor({ supabase, company }, [candidateId]).catch(() => ({}) as Record<string, OutreachBadge>),
    getEntitlements(company.id)
      .then((e) => ({ remaining: e.entitlements.outreach.remaining, amount: e.entitlements.outreach.amount }))
      .catch(() => null),
  ]);

  return {
    ok: true,
    candidateFirstName: firstName(candidate.full_name),
    acceptsOutreach: candidate.accepts_outreach !== false,
    jobs: jobs.data ?? [],
    templates: templates.data ?? [],
    quota,
    companyName: company.name,
    schedulingLink: companyRow.data?.scheduling_url ?? null,
    senderName: (user.user_metadata?.full_name as string | undefined) ?? null,
    latest: latest[candidateId] ?? null,
  };
}
