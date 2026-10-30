import "server-only";
import { z } from "zod";
import { companyAllows } from "@/helpers/companies/require-company";
import type { CompanySessionContext } from "@/helpers/companies/company-session";
import { isUuid } from "@/helpers/agent/auth";

export type PreviewAgentJobDeleteResult =
  | { ok: true; title: string; status: string; applications: number }
  | { ok: false; error: string };

const input = z.object({ jobPostId: z.string().refine(isUuid) });

/**
 * Which job a proposed `deleteJobPost` removes (RA-REQ-005): the title,
 * whether it's live and how many applications go with it. Deletes nothing.
 * The check is the delete's own (jobs.delete on that job). Shared by the
 * agent's approval card and MCP's confirmation.
 */
export async function previewAgentJobDelete(
  { supabase, company }: CompanySessionContext,
  raw: unknown,
): Promise<PreviewAgentJobDeleteResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Job posting not found." };
  const { jobPostId } = parsed.data;

  const denied = companyAllows(company, { permission: "jobs.delete", jobId: jobPostId });
  if (denied) return { ok: false, error: denied };

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
