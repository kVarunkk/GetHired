import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny } from "@/helpers/companies/permissions";
import { scopeToJobs } from "@/helpers/companies/job-scope";
import {
  candidateFiltersFrom,
  listCandidateFilterOptions,
  listCompanyCandidates,
  type CandidateFilters,
  type CompanyCandidateList,
} from "./list-candidates";

export type CandidatesTab = {
  list: CompanyCandidateList;
  filters: CandidateFilters;
  options: { tags: string[]; batches: { id: string; fileName: string }[] };
  /** Active jobs the member can import into (applicants.import). */
  jobs: { id: string; title: string }[];
  /**
   * The "Match to job" filter's jobs: active ones the member can view
   * (CP-REQ-071). Null hides the filter: without talent.view, and on a list.
   */
  matchJobs: { id: string; title: string }[] | null;
  canCreate: boolean;
  canDelete: boolean;
  canManageLists: boolean;
};

/** Active jobs `company`'s member can add candidates to. Extra: an error gives none. */
export async function listImportJobs(
  supabase: SupabaseClient<Database>,
  company: MyCompany,
): Promise<{ id: string; title: string }[]> {
  if (!canAny(company, "applicants.import")) return [];
  const { data } = await scopeToJobs(
    supabase.from("job_postings").select("id, title").eq("company_id", company.id).eq("status", "active"),
    company,
    "applicants.import",
  ).order("created_at", { ascending: false });
  return data ?? [];
}

/** Active jobs `company`'s member can view, to match candidates to. Extra: an error gives none. */
export async function listMatchJobs(
  supabase: SupabaseClient<Database>,
  company: MyCompany,
): Promise<{ id: string; title: string }[]> {
  if (!canAny(company, "jobs.view")) return [];
  const { data } = await scopeToJobs(
    supabase.from("job_postings").select("id, title").eq("company_id", company.id).eq("status", "active"),
    company,
    "jobs.view",
  ).order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * Everything the Candidates table needs (BI-REQ-003), or a talent
 * list's company candidates with `listId` (BI-REQ-006). Throws when the
 * candidates can't be read; the filter options and jobs are extras.
 */
export async function loadCandidatesTab(
  supabase: SupabaseClient<Database>,
  company: MyCompany,
  params: Record<string, string | undefined>,
  { listId = null }: { listId?: string | null } = {},
): Promise<CandidatesTab> {
  const parsed = { ...candidateFiltersFrom(params), listId };
  // CP-REQ-071/072: matching is a pool read, and a list's table doesn't get it.
  const matchJobs = !listId && can(company, "talent.view") ? await listMatchJobs(supabase, company) : null;
  // A job the member can't view is ignored.
  const matchJob = matchJobs?.some((job) => job.id === parsed.matchJob) ? parsed.matchJob : null;
  const filters = { ...parsed, matchJob };
  const [list, options, jobs] = await Promise.all([
    listCompanyCandidates(supabase, company.id, filters),
    listCandidateFilterOptions(supabase, company.id),
    listImportJobs(supabase, company),
  ]);
  return {
    list,
    filters,
    options,
    jobs,
    matchJobs,
    canCreate: canAny(company, "applicants.import"),
    // BI-PERM-002: deleting needs applicants.import for every job.
    canDelete: can(company, "applicants.import"),
    canManageLists: can(company, "talent_lists.manage"),
  };
}
