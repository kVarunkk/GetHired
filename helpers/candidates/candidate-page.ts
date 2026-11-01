import "server-only";
import { cache } from "react";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { createClient } from "@/lib/supabase/server";
import { listImportJobs } from "./candidates-tab";

export { candidatePath, CANDIDATES_LIST_PATH } from "./paths";

/** Everything but the parsed resume, which only the resume section reads. */
const CANDIDATE_COLUMNS =
  "id, full_name, email, phone, location, current_title, current_company, experience_years, links, skills, tags, notes, resume_path, source_batch_id, email_opted_out_at, claimed_user_id, claimed_at, created_at, candidate_import_batches!company_candidates_source_batch_id_fkey(file_name)" as const;

export type CandidateApplication = {
  id: string;
  jobId: string;
  jobTitle: string;
  stageName: string | null;
  stageKind: string | null;
  createdAt: string;
};

/**
 * What every page of a candidate's layout needs (BI-REQ-004): the session,
 * the company, the candidate and their applications. Request-cached, so the
 * layout and the section share one load. Null when the viewer isn't a
 * company member or can't read the candidate (RLS, BI-PERM-002: talent.view,
 * or applicants.view for a job they're in).
 */
export const loadCandidateFrame = cache(async (candidateId: string) => {
  if (!isUuid(candidateId)) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [company, { data: row, error }] = await Promise.all([
    getMyCompany(supabase, user),
    supabase.from("company_candidates").select(CANDIDATE_COLUMNS).eq("id", candidateId).maybeSingle(),
  ]);
  if (error) throw new Error(`Failed to load the candidate: ${error.message}`);
  if (!company || !row) return null;

  const [{ data: apps, error: appsError }, importJobs] = await Promise.all([
    supabase
      .from("applications")
      .select("id, created_at, job_postings(id, title), pipeline_stages(name, kind)")
      .eq("company_candidate_id", candidateId)
      // BI-REQ-042: a merged import shows through the application it joined.
      .is("merged_into_application_id", null)
      .order("created_at", { ascending: false }),
    listImportJobs(supabase, company),
  ]);
  if (appsError) throw new Error(`Failed to load the candidate's applications: ${appsError.message}`);

  const applications: CandidateApplication[] = (apps ?? []).flatMap((a) =>
    a.job_postings
      ? [
          {
            id: a.id,
            jobId: a.job_postings.id,
            jobTitle: a.job_postings.title,
            stageName: a.pipeline_stages?.name ?? null,
            stageKind: a.pipeline_stages?.kind ?? null,
            createdAt: a.created_at,
          },
        ]
      : [],
  );
  const { candidate_import_batches: batch, ...candidate } = row;
  const inJobs = new Set(applications.map((a) => a.jobId));

  return {
    supabase,
    user,
    company,
    candidate: { ...candidate, sourceFile: batch?.file_name ?? null },
    applications,
    /** Jobs they can still be added to (BI-REQ-005). */
    jobs: importJobs.filter((job) => !inJobs.has(job.id)),
    // What update_company_candidate checks: applicants.import unscoped, or
    // for one of the candidate's jobs.
    canEdit:
      can(company, "applicants.import") || applications.some((a) => can(company, "applicants.import", a.jobId)),
    canDelete: can(company, "applicants.import"),
  };
});

export type CandidateFrame = NonNullable<Awaited<ReturnType<typeof loadCandidateFrame>>>;
