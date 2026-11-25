import "server-only";
import type { TrackerContext } from "./context";
import { filterByKeyword } from "./search";
import type { SavedJobItem } from "./types";
import { allJobsSelectString } from "@/helpers/jobs/filterQueryBuilder";
import type { AllJobWithRelations } from "@/utils/types";

/**
 * The Saved tab (AT-REQ-026, AT-DEC-008): board jobs from `user_favorites`
 * and `saved` tracked rows from anywhere else, in one list, newest saved
 * first, with the keyword search over both.
 */
export async function listMySavedJobs(ctx: TrackerContext, { q }: { q?: string | null } = {}): Promise<SavedJobItem[]> {
  const { supabase, user } = ctx;
  const [favoritesRes, trackedRes] = await Promise.all([
    supabase
      .from("user_favorites")
      .select("created_at, all_jobs ( id, job_name, company_name, locations )")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("tracked_applications")
      .select("id, job_title, company_name, location, job_url, notes, created_at")
      .eq("user_id", user.id)
      .eq("status", "saved")
      .order("created_at", { ascending: false }),
  ]);
  if (favoritesRes.error) throw favoritesRes.error;
  if (trackedRes.error) throw trackedRes.error;

  const favorites: SavedJobItem[] = [];
  for (const row of favoritesRes.data ?? []) {
    const job = row.all_jobs as { id: string; job_name: string | null; company_name: string | null; locations: string[] | null } | null;
    if (!job) continue;
    favorites.push({
      kind: "favorite",
      id: job.id,
      allJobsId: job.id,
      jobTitle: job.job_name?.trim() || "Untitled job",
      companyName: job.company_name?.trim() || "Unknown company",
      location: job.locations?.[0] ?? null,
      savedAt: row.created_at,
    });
  }

  const tracked: SavedJobItem[] = (trackedRes.data ?? []).map((row) => ({
    kind: "tracked",
    id: row.id,
    allJobsId: null,
    jobTitle: row.job_title,
    companyName: row.company_name,
    location: row.location,
    jobUrl: row.job_url,
    notes: row.notes,
    savedAt: row.created_at,
  }));

  return filterByKeyword([...favorites, ...tracked], q).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/**
 * The board jobs behind the Saved tab's favorites, as the feed's job cards
 * read them, plus which ones match the user's profile.
 */
export async function loadSavedBoardJobs(
  ctx: TrackerContext,
  ids: string[],
): Promise<{ jobs: AllJobWithRelations[]; matchedIds: string[] }> {
  if (ids.length === 0) return { jobs: [], matchedIds: [] };
  const [jobsRes, matchesRes] = await Promise.all([
    ctx.supabase.from("all_jobs").select(allJobsSelectString).in("id", ids),
    ctx.supabase.from("user_relevant_jobs").select("jobs_id").eq("user_id", ctx.user.id).in("jobs_id", ids),
  ]);
  if (jobsRes.error) throw jobsRes.error;
  const jobs = ((jobsRes.data ?? []) as unknown as AllJobWithRelations[]).map((job) => ({
    ...job,
    user_favorites: [],
    applications: [],
  }));
  const matchedIds = (matchesRes.data ?? []).map((row) => row.jobs_id).filter((id): id is string => Boolean(id));
  return { jobs, matchedIds };
}
