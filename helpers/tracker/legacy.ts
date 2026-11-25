import "server-only";
import { legacyTrackedStatus } from "./status";
import { isCapError, isUniqueViolation, type TrackerContext } from "./context";

// Until migration B runs (spec §7.1), an external application can still be an
// `applications` row with no job_post_id. Touching one copies it into the
// tracker first, so no new write goes to `applications` (ATT-031).

type LegacyRow = {
  id: string;
  status: "submitted" | "reviewed" | "selected" | "stand_by" | "rejected";
  created_at: string;
  all_jobs: { id: string; job_name: string | null; company_name: string | null; locations: string[] | null } | null;
};

/**
 * Moves the user's legacy external application for a board job into the
 * tracker. Returns the tracked id, or null when there was none. A failed
 * delete of the old row is harmless: the list hides a legacy row that has a
 * tracked twin.
 */
export async function adoptLegacyApplication(
  ctx: TrackerContext,
  allJobsId: string,
): Promise<{ ok: true; id: string | null } | { ok: false; reason: "limit" | "error" }> {
  const { supabase, user } = ctx;
  const { data, error } = await supabase
    .from("applications")
    .select("id, status, created_at, all_jobs ( id, job_name, company_name, locations )")
    .eq("applicant_user_id", user.id)
    .eq("all_jobs_id", allJobsId)
    .is("job_post_id", null)
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, reason: "error" };
  const legacy = data as LegacyRow | null;
  if (!legacy) return { ok: true, id: null };

  const job = legacy.all_jobs;
  const { data: inserted, error: insertError } = await supabase
    .from("tracked_applications")
    .insert({
      user_id: user.id,
      all_jobs_id: allJobsId,
      job_title: job?.job_name?.trim().slice(0, 200) || "Untitled job",
      company_name: job?.company_name?.trim().slice(0, 200) || "Unknown company",
      location: job?.locations?.[0]?.slice(0, 200) ?? null,
      status: legacyTrackedStatus(legacy.status),
      applied_at: legacy.created_at.slice(0, 10),
      source: "migrated",
    })
    .select("id")
    .single();

  let id = inserted?.id ?? null;
  if (insertError) {
    if (isCapError(insertError)) return { ok: false, reason: "limit" };
    if (!isUniqueViolation(insertError)) return { ok: false, reason: "error" };
    const { data: existing } = await supabase
      .from("tracked_applications")
      .select("id")
      .eq("user_id", user.id)
      .eq("all_jobs_id", allJobsId)
      .maybeSingle();
    id = existing?.id ?? null;
  }

  await supabase.from("applications").delete().eq("id", legacy.id).eq("applicant_user_id", user.id).is("job_post_id", null);
  return { ok: true, id };
}

/**
 * The user's tracked card for a board job: the tracked row, or their old
 * external application copied into the tracker first (ATT-031). `null` when
 * there's neither.
 */
export async function trackedIdForBoardJob(
  ctx: TrackerContext,
  allJobsId: string,
): Promise<{ ok: true; id: string | null } | { ok: false; reason: "limit" | "error" }> {
  const { data, error } = await ctx.supabase
    .from("tracked_applications")
    .select("id")
    .eq("user_id", ctx.user.id)
    .eq("all_jobs_id", allJobsId)
    .maybeSingle();
  if (error) return { ok: false, reason: "error" };
  if (data) return { ok: true, id: data.id };
  return adoptLegacyApplication(ctx, allJobsId);
}
