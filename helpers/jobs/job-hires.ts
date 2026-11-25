import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { JobPostState } from "./job-states";

/**
 * JL-REQ-012: hires on each job, keyed by job post id. A hire is an
 * application in a stage of kind `hired` that wasn't merged into another
 * (merged ones stay readable but don't count). Jobs with none are left out.
 * Reads through the caller's client, so RLS scopes it to what they can see.
 */
export async function countJobHires(
  supabase: SupabaseClient<Database>,
  jobPostIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (jobPostIds.length === 0) return counts;

  const { data, error } = await supabase
    .from("applications")
    .select("job_post_id, pipeline_stages!inner(kind)")
    .in("job_post_id", jobPostIds)
    .is("merged_into_application_id", null)
    .eq("pipeline_stages.kind", "hired");
  if (error) throw new Error("Failed to count the job's hires.");

  for (const row of data ?? []) {
    if (!row.job_post_id) continue;
    counts.set(row.job_post_id, (counts.get(row.job_post_id) ?? 0) + 1);
  }
  return counts;
}

/** One job's hires. */
export async function countHiresFor(supabase: SupabaseClient<Database>, jobPostId: string): Promise<number> {
  return (await countJobHires(supabase, [jobPostId])).get(jobPostId) ?? 0;
}

/**
 * D5 / JL-REQ-013: whether to suggest "Mark as filled". Only for an open or
 * paused job whose hires reached its openings; nothing changes by itself.
 */
export function shouldSuggestFill(job: { state: JobPostState; openings: number }, hires: number): boolean {
  return (job.state === "open" || job.state === "paused") && hires >= job.openings;
}

/** "Hired 1 of 3". */
export function hiresLabel(hires: number, openings: number): string {
  return `Hired ${hires} of ${openings}`;
}

export type FillSuggestion = { jobPostId: string; title: string; hires: number; openings: number };

/**
 * JL-REQ-013: after applications moved into a `hired` stage, the jobs whose
 * hires just reached their openings (open or paused only). A job that had
 * already reached them before this move isn't suggested again.
 */
export async function fillSuggestions(
  supabase: SupabaseClient<Database>,
  moved: { jobPostId: string; fromKind: string | null }[],
): Promise<FillSuggestion[]> {
  const newHires = new Map<string, number>();
  for (const app of moved) {
    if (app.fromKind === "hired") continue;
    newHires.set(app.jobPostId, (newHires.get(app.jobPostId) ?? 0) + 1);
  }
  const ids = [...newHires.keys()];
  if (ids.length === 0) return [];

  const { data: jobs, error } = await supabase
    .from("job_postings")
    .select("id, title, state, openings")
    .in("id", ids);
  if (error) throw new Error("Failed to load the jobs.");
  const counts = await countJobHires(supabase, ids);

  const suggestions: FillSuggestion[] = [];
  for (const job of jobs ?? []) {
    const hires = counts.get(job.id) ?? 0;
    const before = hires - (newHires.get(job.id) ?? 0);
    if (shouldSuggestFill(job, hires) && before < job.openings) {
      suggestions.push({ jobPostId: job.id, title: job.title, hires, openings: job.openings });
    }
  }
  return suggestions;
}
