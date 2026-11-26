import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";

type AllJobsInsert = Database["public"]["Tables"]["all_jobs"]["Insert"];

/** The posting columns the public `all_jobs` row is built from. */
export type PublicJobSource = {
  id: string;
  job_id: string | null;
  company_id: string;
  title: string;
  description: string | null;
  location: string[] | null;
  job_type: Database["public"]["Enums"]["job_type_enum"];
  salary_range: string | null;
  salary_currency: string | null;
  min_salary: number | null;
  max_salary: number | null;
  experience: string | null;
  min_experience: number | null;
  max_experience: number | null;
  equity_range: string | null;
  min_equity: number | null;
  max_equity: number | null;
  visa_sponsorship: string | null;
  /** `link_only` keeps the job out of every listing (all_jobs.listed). */
  visibility?: Database["public"]["Enums"]["job_post_visibility"];
  embedding_new?: string | null;
};

/** The columns ensurePublicJobRow needs, for a `.select(...)`. */
export const PUBLIC_JOB_SOURCE_COLUMNS =
  "id, job_id, company_id, title, description, location, job_type, salary_range, salary_currency, min_salary, max_salary, experience, min_experience, max_experience, equity_range, min_equity, max_equity, visa_sponsorship, visibility, embedding_new";

/**
 * The `all_jobs` columns that mirror a posting (JL-REQ-006): one mapping for
 * the edit sync and the first opening, so the two can't drift. Status,
 * platform and the company link are set only when the row is created.
 */
export function allJobsRowFrom(posting: PublicJobSource) {
  return {
    job_name: posting.title,
    job_type: posting.job_type,
    description: posting.description,
    locations: posting.location ?? [],
    visa_requirement: posting.visa_sponsorship,
    salary_range: posting.salary_range,
    // "" (no salary) is stored as no currency.
    salary_currency: posting.salary_currency || null,
    salary_min: posting.min_salary,
    salary_max: posting.max_salary,
    experience: posting.experience,
    // all_jobs.experience_min is not null with a default: leave it out when unset.
    ...(posting.min_experience != null ? { experience_min: posting.min_experience } : {}),
    experience_max: posting.max_experience,
    equity_range: posting.equity_range,
    equity_min: posting.min_equity,
    equity_max: posting.max_equity,
    // Mirrors the posting (JL-REQ-024); a trigger keeps it in step as well.
    ...(posting.visibility ? { listed: posting.visibility === "public" } : {}),
  } satisfies Partial<AllJobsInsert>;
}

/**
 * Gives a posting its public `all_jobs` row before it opens for the first
 * time (D4: drafts have none). Inserts it `inactive`, so nothing is listed
 * until `set_job_post_state` opens the job in the same transaction as the
 * status change. Returns the row's id; a posting that has one already gets it
 * back unchanged, and a row left by a refused or failed open is reused.
 *
 * `service` is the service-role client: ownership is checked by the caller.
 */
export async function ensurePublicJobRow(
  service: SupabaseClient<Database>,
  posting: PublicJobSource,
  company: { id: string; name: string | null },
): Promise<string> {
  if (posting.job_id) return posting.job_id;

  const { data: inserted, error: insertError } = await service
    .from("all_jobs")
    .insert({
      ...allJobsRowFrom(posting),
      ...(posting.embedding_new ? { embedding_new: posting.embedding_new } : {}),
      company_url: `/companies/${company.id}`,
      company_name: company.name ?? "",
      platform: "gethired",
      status: "inactive",
      is_platform_job: true,
    })
    .select("id")
    .single();
  if (insertError || !inserted) {
    reportError(`[job posting] couldn't insert the listing for ${posting.id}`, insertError);
    throw new Error("Failed to create the public job listing.");
  }

  // Only when the posting still has none: a concurrent open may have won.
  const { data: linked, error: linkError } = await service
    .from("job_postings")
    .update({ job_id: inserted.id })
    .eq("id", posting.id)
    .is("job_id", null)
    .select("job_id");
  if (linkError) throw new Error("Failed to link the public job listing.");
  if (linked && linked.length > 0) return inserted.id;

  // Lost the race: use the winner's row and drop ours.
  const { data: current, error: readError } = await service
    .from("job_postings")
    .select("job_id")
    .eq("id", posting.id)
    .maybeSingle();
  if (readError || !current?.job_id) throw new Error("Failed to link the public job listing.");
  const { error: deleteError } = await service.from("all_jobs").delete().eq("id", inserted.id);
  if (deleteError) reportError(`[job posting] couldn't remove the extra listing ${inserted.id}`, deleteError);
  return current.job_id;
}
