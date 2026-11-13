import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { scopeToJobs } from "@/helpers/companies/job-scope";
import { reportError } from "@/helpers/posthog/report-error";
import { APPLICATIONS_PAGE_SIZE, escapeLike, type ApplicationListParams } from "./list-params";

/** One row of the company Applications list (QF-REQ-020). */
export type CompanyApplicationRow = Pick<
  Tables<"company_application_list">,
  | "id"
  | "created_at"
  | "status"
  | "job_post_id"
  | "job_title"
  | "person_name"
  | "applicant_user_id"
  | "company_candidate_id"
  | "fit_score"
  | "screening_status"
  | "recommendation"
  | "knockout_failed"
  | "knockout_reasons"
  | "candidate_has_resume"
>;

const COLUMNS =
  "id, created_at, status, job_post_id, job_title, person_name, applicant_user_id, company_candidate_id, fit_score, screening_status, recommendation, knockout_failed, knockout_reasons, candidate_has_resume";

export type CompanyApplicationList =
  | {
      ok: true;
      rows: CompanyApplicationRow[];
      total: number;
      /** The page shown: the last one when the asked-for page is past the end. */
      page: number;
      pageSize: number;
      /** The job filter's options: the jobs whose applications the member can see. */
      jobs: { id: string; title: string }[];
    }
  | { ok: false; error: string };

type Ctx = { supabase: SupabaseClient<Database>; company: MyCompany };

const ERROR = "Couldn't load the applications.";

/**
 * One page of the session company's applications (QF-REQ-021), filtered,
 * sorted and paged by the database. The company comes from the session and
 * scoped members only see their assigned jobs; RLS applies underneath.
 */
export async function loadCompanyApplications(
  { supabase, company }: Ctx,
  params: ApplicationListParams,
): Promise<CompanyApplicationList> {
  const filtered = (options: { count: "exact"; head?: boolean }) => {
    let query = scopeToJobs(
      supabase
        .from("company_application_list")
        .select(COLUMNS, options)
        .eq("company_id", company.id),
      company,
      "applicants.view",
      "job_post_id",
    );
    if (params.q) query = query.ilike("person_name", `%${escapeLike(params.q)}%`);
    if (params.job) query = query.eq("job_post_id", params.job);
    if (params.status) query = query.eq("status", params.status);
    if (params.recommendation) query = query.eq("recommendation", params.recommendation);
    if (params.knockout) query = query.eq("knockout_failed", params.knockout === "failed");
    return query;
  };
  const pageOf = (page: number) => {
    const from = (page - 1) * APPLICATIONS_PAGE_SIZE;
    return filtered({ count: "exact" })
      .order(params.sort, { ascending: params.dir === "asc", nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + APPLICATIONS_PAGE_SIZE - 1);
  };
  const lastPage = (total: number) => Math.max(1, Math.ceil(total / APPLICATIONS_PAGE_SIZE));

  const jobsQuery = scopeToJobs(
    supabase.from("job_postings").select("id, title").eq("company_id", company.id),
    company,
    "applicants.view",
  ).order("created_at", { ascending: false });

  const [first, jobsResult] = await Promise.all([pageOf(params.page), jobsQuery]);
  let { data, error, count } = first;
  let page = params.page;

  // A page past the end: PostgREST either returns no rows or refuses the range.
  if (error?.code === "PGRST103") {
    const head = await filtered({ count: "exact", head: true });
    if (head.error) {
      reportError("[applications list] couldn't count the applications", head.error);
      return { ok: false, error: ERROR };
    }
    page = Math.min(page, lastPage(head.count ?? 0));
    ({ data, error, count } = await pageOf(page));
  } else if (!error && (data ?? []).length === 0 && page > lastPage(count ?? 0)) {
    page = lastPage(count ?? 0);
    ({ data, error, count } = await pageOf(page));
  }

  if (error) {
    reportError("[applications list] couldn't load the applications", error);
    return { ok: false, error: ERROR };
  }

  return {
    ok: true,
    rows: (data ?? []) as CompanyApplicationRow[],
    total: count ?? 0,
    page,
    pageSize: APPLICATIONS_PAGE_SIZE,
    // The job filter is an extra: without its options the list still works.
    jobs: jobsResult.data ?? [],
  };
}
