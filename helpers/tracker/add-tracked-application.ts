import "server-only";
import { PLATFORM_JOB_REFUSED } from "@/helpers/applications/external-application";
import { findBoardJobIdByUrl } from "./board-match";
import { TRACKER_COPY } from "./copy";
import { isCapError, isUniqueViolation, type TrackerContext, type TrackerSource } from "./context";
import { adoptLegacyApplication } from "./legacy";
import { normalizeJobUrl } from "./job-url";
import { isBoardJobInput, type TrackedInput } from "./schema";
import type { TrackedStatus } from "./status";

export type AddTrackedResult =
  | { ok: true; kind: "tracked"; created: true; moved: false; id: string; status: TrackedStatus }
  | { ok: true; kind: "tracked"; created: false; moved: boolean; id: string; status: TrackedStatus }
  | { ok: true; kind: "favorite"; allJobsId: string }
  | { ok: false; reason: "applied_on_gethired"; applicationId: string; error: string }
  | { ok: false; reason: "platform_job" | "not_found" | "limit" | "error"; error: string };

type BoardJob = {
  id: string;
  job_name: string | null;
  company_name: string | null;
  locations: string[] | null;
  is_platform_job: boolean | null;
};

const fail = (reason: "platform_job" | "not_found" | "limit" | "error"): AddTrackedResult => ({
  ok: false,
  reason,
  error:
    reason === "platform_job"
      ? PLATFORM_JOB_REFUSED
      : reason === "not_found"
        ? TRACKER_COPY.jobNotFound
        : reason === "limit"
          ? TRACKER_COPY.limit
          : TRACKER_COPY.unexpected,
});

const clip = (value: string | null | undefined, max: number) => {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

/**
 * Every way into the tracker (AT-REQ-030, AT-REQ-031): the board prompt, Add
 * job, the agent, MCP and the extension. `input` is already parsed with
 * `trackedInputSchema`; the user comes from `ctx` only.
 */
export async function addTrackedApplication(
  ctx: TrackerContext,
  input: TrackedInput,
  source: TrackerSource,
): Promise<AddTrackedResult> {
  const { supabase, user } = ctx;
  const status = input.status;
  const jobUrl = isBoardJobInput(input) ? null : input.jobUrl;
  const jobUrlKey = normalizeJobUrl(jobUrl);

  // 1. Resolve the job.
  const allJobsId = isBoardJobInput(input) ? input.allJobsId : await findBoardJobIdByUrl(jobUrl);
  let job: BoardJob | null = null;
  if (allJobsId) {
    const { data, error } = await supabase
      .from("all_jobs")
      .select("id, job_name, company_name, locations, is_platform_job")
      .eq("id", allJobsId)
      .maybeSingle();
    if (error) return fail("error");
    job = data;
    if (!job && isBoardJobInput(input)) return fail("not_found");
  }

  if (job) {
    // 2. Applied through GetHired?
    const { data: platformApplication, error } = await supabase
      .from("applications")
      .select("id")
      .eq("applicant_user_id", user.id)
      .eq("all_jobs_id", job.id)
      .not("job_post_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (error) return fail("error");
    if (platformApplication) {
      return {
        ok: false,
        reason: "applied_on_gethired",
        applicationId: platformApplication.id,
        error: TRACKER_COPY.appliedOnGetHired,
      };
    }

    // 3. Saving a board job writes user_favorites (AT-REQ-008).
    if (status === "saved") {
      const { error: favoriteError } = await supabase.from("user_favorites").insert({ user_id: user.id, job_id: job.id });
      if (favoriteError && !isUniqueViolation(favoriteError)) return fail("error");
      return { ok: true, kind: "favorite", allJobsId: job.id };
    }

    // Easy Apply jobs are applied to, not tracked (AT-REQ-032).
    if (job.is_platform_job) return fail("platform_job");

    // An old external `applications` row becomes the card (ATT-031).
    const adopted = await adoptLegacyApplication(ctx, job.id);
    if (!adopted.ok) return fail(adopted.reason);
  }

  // 4. Already tracked?
  // The key is URL-encoded (no quotes or commas), so it's safe quoted in or().
  const matchers = [
    ...(job ? [`all_jobs_id.eq.${job.id}`] : []),
    ...(jobUrlKey ? [`job_url_key.eq."${jobUrlKey}"`] : []),
  ];
  const findExisting = async () => {
    if (matchers.length === 0) return { data: null, error: null };
    return supabase
      .from("tracked_applications")
      .select("id, status, all_jobs_id")
      .eq("user_id", user.id)
      .or(matchers.join(","))
      .limit(1)
      .maybeSingle();
  };

  const { data: existing, error: existingError } = await findExisting();
  if (existingError) return fail("error");
  if (existing) return moveIfSaved(ctx, existing, status, job?.id ?? null, input.appliedAt);

  // 5. Insert. The `created` event comes from the trigger.
  const { data: inserted, error: insertError } = await supabase
    .from("tracked_applications")
    .insert({
      user_id: user.id,
      all_jobs_id: job?.id ?? null,
      // A GetHired job always keeps its own title, company and place, whatever was typed.
      job_title: (job ? clip(job.job_name, 200) : null) ?? (isBoardJobInput(input) ? null : input.jobTitle) ?? "Untitled job",
      company_name:
        (job ? clip(job.company_name, 200) : null) ?? (isBoardJobInput(input) ? null : input.companyName) ?? "Unknown company",
      job_url: jobUrl,
      job_url_key: jobUrlKey,
      // A GetHired job keeps its description in all_jobs.
      job_description: job || isBoardJobInput(input) ? null : input.jobDescription,
      location: (job ? clip(job.locations?.[0], 200) : null) ?? (isBoardJobInput(input) ? null : input.location),
      status,
      applied_at: status === "saved" ? null : input.appliedAt,
      next_follow_up_at: input.nextFollowUpAt,
      notes: input.notes,
      resume_id: input.resumeId,
      source,
    })
    .select("id, status")
    .single();

  if (insertError) {
    if (isCapError(insertError)) return fail("limit");
    if (!isUniqueViolation(insertError)) return fail("error");
    // Lost a race with another add of the same job: that row is the card.
    const { data: raced } = await findExisting();
    if (!raced) return fail("error");
    return moveIfSaved(ctx, raced, status, job?.id ?? null, input.appliedAt);
  }

  return { ok: true, kind: "tracked", created: true, moved: false, id: inserted.id, status: inserted.status };
}

/** An existing card: a saved one moves to the new applied status; anything else stays (AT-REQ-031 step 4). */
async function moveIfSaved(
  ctx: TrackerContext,
  existing: { id: string; status: TrackedStatus; all_jobs_id: string | null },
  status: TrackedStatus,
  allJobsId: string | null,
  appliedAt: string | null,
): Promise<AddTrackedResult> {
  if (existing.status !== "saved" || status === "saved") {
    return { ok: true, kind: "tracked", created: false, moved: false, id: existing.id, status: existing.status };
  }
  const { data, error } = await ctx.supabase
    .from("tracked_applications")
    .update({
      status,
      ...(appliedAt ? { applied_at: appliedAt } : {}),
      ...(allJobsId && !existing.all_jobs_id ? { all_jobs_id: allJobsId } : {}),
    })
    .eq("id", existing.id)
    .eq("user_id", ctx.user.id)
    .select("id, status")
    .maybeSingle();
  if (error || !data) return fail("error");
  return { ok: true, kind: "tracked", created: false, moved: true, id: data.id, status: data.status };
}
