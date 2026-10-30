import "server-only";
import { z } from "zod";
import { companyAllows } from "@/helpers/companies/require-company";
import type { CompanySessionContext } from "@/helpers/companies/company-session";

const inputSchema = z.object({
  jobPostId: z.string().uuid(),
  candidateIds: z.array(z.string().uuid()).min(1).max(50),
  stageId: z.string().uuid().optional(),
});

export type AddToJobPreview =
  | {
      ok: true;
      jobTitle: string;
      /** Null: the job's first stage. */
      stageName: string | null;
      /** Who'd be added; no contact details, only whether there's an email. */
      candidates: { id: string; name: string; hasEmail: boolean }[];
      /** Ids that aren't the company's candidates. */
      notFound: number;
    }
  | { ok: false; error: string };

/**
 * CPT-058: what a proposed `addCandidatesToJob` call would do: the job, the
 * stage and the people by name, with who has no email (and so won't be
 * added). Writes nothing; the add checks everything again. Shared by the
 * agent's approval card and MCP's confirmation.
 */
export async function previewAgentAddToJob(
  { supabase, company }: CompanySessionContext,
  input: unknown,
): Promise<AddToJobPreview> {
  const parsed = inputSchema.safeParse(input);
  const denied = companyAllows(company, {
    permission: "applicants.import",
    jobId: parsed.success ? parsed.data.jobPostId : null,
  });
  if (denied) return { ok: false, error: denied };
  if (!parsed.success) return { ok: false, error: "Couldn't read this request." };
  const { jobPostId, stageId } = parsed.data;
  const ids = [...new Set(parsed.data.candidateIds)];

  const [{ data: job }, { data: stage }, { data: rows, error }] = await Promise.all([
    supabase.from("job_postings").select("id, title").eq("id", jobPostId).eq("company_id", company.id).maybeSingle(),
    stageId
      ? supabase.from("pipeline_stages").select("name").eq("id", stageId).eq("company_id", company.id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("company_candidates").select("id, full_name, email").eq("company_id", company.id).in("id", ids),
  ]);
  if (error) return { ok: false, error: "Couldn't load the candidates." };
  if (!job) return { ok: false, error: "Job post not found." };
  if (stageId && !stage) return { ok: false, error: "Pick one of your pipeline stages." };

  const rowOf = new Map((rows ?? []).map((r) => [r.id, r]));
  const candidates = ids.flatMap((id) => {
    const row = rowOf.get(id);
    return row ? [{ id, name: row.full_name, hasEmail: !!row.email }] : [];
  });
  return {
    ok: true,
    jobTitle: job.title,
    stageName: stage?.name ?? null,
    candidates,
    notFound: ids.length - candidates.length,
  };
}
