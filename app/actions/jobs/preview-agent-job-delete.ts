"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";

export type PreviewAgentJobDeleteResult =
  | { ok: true; title: string; status: string; applications: number }
  | { ok: false; error: string };

const input = z.object({ jobPostId: z.string().refine(isUuid) });

/**
 * SERVER ACTION: which job the agent's proposed `deleteJobPost` removes, for
 * its approval card (RA-REQ-005): the title, whether it's live and how many
 * applications go with it. Deletes nothing. The company comes from the
 * session, and the check is the delete's own (jobs.delete on that job).
 */
export async function previewAgentJobDeleteAction(raw: unknown): Promise<PreviewAgentJobDeleteResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Job posting not found." };
  const { jobPostId } = parsed.data;

  const auth = await requireCompanyForAction({ permission: "jobs.delete", jobId: jobPostId });
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase, company } = auth;

  const [{ data: job, error }, { count }] = await Promise.all([
    supabase
      .from("job_postings")
      .select("id, title, status")
      .eq("id", jobPostId)
      .eq("company_id", company.id)
      .maybeSingle(),
    supabase.from("applications").select("id", { count: "exact", head: true }).eq("job_post_id", jobPostId),
  ]);
  if (error) return { ok: false, error: "Failed to load the job posting." };
  if (!job) return { ok: false, error: "Job posting not found." };

  return { ok: true, title: job.title, status: job.status, applications: count ?? 0 };
}
