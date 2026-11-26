import "server-only";
import { TRACKER_COPY } from "./copy";
import { isUniqueViolation, type TrackerContext } from "./context";
import { normalizeJobUrl } from "./job-url";
import { trackedItem, TRACKED_COLUMNS } from "./list-my-applications";
import type { Database } from "@/utils/types/database.types";
import type { NoteInput, TrackedUpdate } from "./schema";
import type { AppliedStatus } from "./status";
import type { TrackerItem } from "./types";

// The edits shared by the actions, the agent and MCP (AT-REQ-038). Every
// write filters on the ctx user as well as the id, so a foreign id is "not
// found", never someone else's card.

export type WriteResult<T = TrackerItem> = { ok: true; item: T } | { ok: false; reason: "not_found" | "conflict" | "error"; error: string };

const notFound = { ok: false, reason: "not_found", error: TRACKER_COPY.notFound } as const;
const unexpected = { ok: false, reason: "error", error: TRACKER_COPY.unexpected } as const;

/** Edits a tracked card's details. Status goes through `setTrackedStatus`. */
export async function updateTrackedApplication(ctx: TrackerContext, id: string, update: TrackedUpdate): Promise<WriteResult> {
  const patch: Database["public"]["Tables"]["tracked_applications"]["Update"] = {};
  if (update.jobTitle !== undefined) patch.job_title = update.jobTitle;
  if (update.companyName !== undefined) patch.company_name = update.companyName;
  if (update.jobUrl !== undefined) {
    patch.job_url = update.jobUrl;
    patch.job_url_key = normalizeJobUrl(update.jobUrl);
  }
  if (update.location !== undefined) patch.location = update.location;
  if (update.jobDescription !== undefined) patch.job_description = update.jobDescription;
  if (update.appliedAt !== undefined && update.appliedAt !== null) patch.applied_at = update.appliedAt;
  if (update.nextFollowUpAt !== undefined) patch.next_follow_up_at = update.nextFollowUpAt;
  if (update.notes !== undefined) patch.notes = update.notes;
  if (update.contactName !== undefined) patch.contact_name = update.contactName;
  if (update.resumeId !== undefined) patch.resume_id = update.resumeId;
  if (update.salaryAmount !== undefined) patch.salary_amount = update.salaryAmount;
  if (update.salaryCurrency !== undefined) patch.salary_currency = update.salaryCurrency;

  // A card on a GetHired job takes its title, company, link and place from the job.
  const editsIdentity = ["job_title", "company_name", "job_url", "job_url_key", "location", "job_description"].some((key) => key in patch);
  if (editsIdentity) {
    const { data: current, error: currentError } = await ctx.supabase
      .from("tracked_applications")
      .select("all_jobs_id")
      .eq("id", id)
      .eq("user_id", ctx.user.id)
      .maybeSingle();
    if (currentError) return unexpected;
    if (!current) return notFound;
    if (current.all_jobs_id) {
      delete patch.job_title;
      delete patch.company_name;
      delete patch.job_url;
      delete patch.job_url_key;
      delete patch.location;
      delete patch.job_description;
    }
  }
  if (Object.keys(patch).length === 0) return getTrackedItem(ctx, id);

  const { data, error } = await ctx.supabase
    .from("tracked_applications")
    .update(patch)
    .eq("id", id)
    .eq("user_id", ctx.user.id)
    .select(TRACKED_COLUMNS)
    .maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "conflict", error: TRACKER_COPY.exists };
    return unexpected;
  }
  if (!data) return notFound;
  return { ok: true, item: trackedItem(data) };
}

/**
 * Moves a tracked card (AT-REQ-015): a new status, and optionally its place
 * in the column and an applied date (Mark as applied, AT-REQ-026). `saved`
 * isn't a target: a card never goes back to Saved.
 */
export async function setTrackedStatus(
  ctx: TrackerContext,
  id: string,
  status: AppliedStatus,
  options: { position?: number; appliedAt?: string | null } = {},
): Promise<WriteResult> {
  const { data, error } = await ctx.supabase
    .from("tracked_applications")
    .update({
      status,
      ...(options.position !== undefined ? { position: options.position } : {}),
      ...(options.appliedAt ? { applied_at: options.appliedAt } : {}),
    })
    .eq("id", id)
    .eq("user_id", ctx.user.id)
    .select(TRACKED_COLUMNS)
    .maybeSingle();
  if (error) return unexpected;
  if (!data) return notFound;
  return { ok: true, item: trackedItem(data) };
}

/** Saved → Applied (AT-REQ-026), with the date the user applied, today by default. */
export const markAsApplied = (ctx: TrackerContext, id: string, appliedAt?: string | null) =>
  setTrackedStatus(ctx, id, "applied", { appliedAt: appliedAt ?? null });

/** Deletes a tracked card and its timeline (cascade). */
export async function removeTrackedApplication(
  ctx: TrackerContext,
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" | "error"; error: string }> {
  const { data, error } = await ctx.supabase
    .from("tracked_applications")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.user.id)
    .select("id");
  if (error) return unexpected;
  if (!data || data.length === 0) return notFound;
  return { ok: true, id };
}

/** One tracked card of the user. */
export async function getTrackedItem(ctx: TrackerContext, id: string): Promise<WriteResult> {
  const { data, error } = await ctx.supabase
    .from("tracked_applications")
    .select(TRACKED_COLUMNS)
    .eq("id", id)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error) return unexpected;
  if (!data) return notFound;
  return { ok: true, item: trackedItem(data) };
}

/**
 * The applicant's private note and follow-up date on their own GetHired
 * application (AT-REQ-039). Never a status.
 */
export async function saveApplicationNote(
  ctx: TrackerContext,
  input: NoteInput,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "error"; error: string }> {
  const { data: application, error: readError } = await ctx.supabase
    .from("applications")
    .select("id")
    .eq("id", input.applicationId)
    .eq("applicant_user_id", ctx.user.id)
    .not("job_post_id", "is", null)
    .maybeSingle();
  if (readError) return unexpected;
  if (!application) return notFound;

  const { error } = await ctx.supabase.from("applicant_application_notes").upsert(
    {
      application_id: input.applicationId,
      user_id: ctx.user.id,
      notes: input.notes,
      next_follow_up_at: input.nextFollowUpAt,
    },
    { onConflict: "application_id" },
  );
  if (error) return unexpected;
  return { ok: true };
}
