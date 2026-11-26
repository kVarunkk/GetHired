import "server-only";
import type { TrackerContext } from "@/helpers/tracker/context";
import { isRelevanceInProgress } from "@/helpers/jobs/relevance-jobs-queue";

export type RecommendedJob = {
  id: string;
  jobTitle: string;
  companyName: string;
  location: string | null;
};

/**
 * The dashboard's matches. `no_profile`: onboarding isn't done, so there's no
 * feed. `processing`, `not_run`, `failed`: the feed is empty and why, read the
 * way the agent's findRelevantJobs reads it. `ready` can still hold no jobs
 * when every match is already applied to or saved.
 */
export type RecommendedJobs =
  | { state: "ready"; jobs: RecommendedJob[] }
  | { state: "no_profile" | "processing" | "not_run" | "failed" };

export type RelevanceProfile = {
  filled: boolean;
  relevant_jobs_update_status: string;
  relevance_started_at: string | null;
  updated_at: string | null;
};

/** Read this many from the top of the feed, so excluded jobs still leave `limit`. */
const OVERFETCH = 30;

/**
 * The user's best active matches from their stored feed (user_relevant_jobs),
 * best first, leaving out `exclude` (jobs they applied to or saved).
 */
export async function loadRecommendedJobs(
  ctx: TrackerContext,
  { profile, exclude, limit = 5 }: { profile: RelevanceProfile; exclude: Set<string>; limit?: number },
): Promise<RecommendedJobs> {
  if (!profile.filled) return { state: "no_profile" };

  const { data, error } = await ctx.supabase
    .from("user_relevant_jobs")
    .select("relevance_rank, all_jobs!inner(id, job_name, company_name, locations, status)")
    .eq("user_id", ctx.user.id)
    .eq("all_jobs.status", "active")
    .order("relevance_rank", { ascending: true })
    .limit(Math.min(100, OVERFETCH + exclude.size));
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) {
    if (isRelevanceInProgress(profile)) return { state: "processing" };
    if (profile.relevant_jobs_update_status === "pending") return { state: "not_run" };
    if (profile.relevant_jobs_update_status === "failed" || profile.relevant_jobs_update_status === "progress") {
      return { state: "failed" };
    }
    return { state: "ready", jobs: [] };
  }

  const jobs: RecommendedJob[] = [];
  for (const row of rows) {
    const job = row.all_jobs as { id: string; job_name: string | null; company_name: string | null; locations: string[] | null };
    if (exclude.has(job.id)) continue;
    jobs.push({
      id: job.id,
      jobTitle: job.job_name?.trim() || "Untitled job",
      companyName: job.company_name?.trim() || "Unknown company",
      location: job.locations?.[0] ?? null,
    });
    if (jobs.length === limit) break;
  }
  return { state: "ready", jobs };
}
