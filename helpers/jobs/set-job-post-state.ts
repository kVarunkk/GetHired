import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { careersCompanyTag } from "@/helpers/careers/cache-tags";
import { isUuid } from "@/helpers/agent/auth";
import { assertLimit } from "@/helpers/billing/entitlements";
import {
  EntitlementError,
  toEntitlementActionError,
  type EntitlementActionError,
} from "@/helpers/billing/errors";
import { enqueueFeedRebuild } from "@/helpers/distribution/feed-queue";
import { enqueueIndexPing } from "@/helpers/distribution/index-queue";
import { queueJobPostingRelevance } from "@/helpers/profiles/queue-job-relevance";
import { reportError } from "@/helpers/posthog/report-error";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  PUBLIC_JOB_SOURCE_COLUMNS,
  allJobsRowFrom,
  ensurePublicJobRow,
  type PublicJobSource,
} from "./all-jobs-row";
import { sendApprovalEmails } from "./job-approval-emails";
import { JOB_STATE_FAILED, JOB_STATE_REFUSALS, jobStateRefusalCopy } from "./job-state-copy";
import {
  STATE_NOTE_MAX,
  isJobPostState,
  isManualCloseReason,
  type JobPostState,
  type ManualCloseReason,
} from "./job-states";

export type SetJobPostStateInput = {
  jobPostId: string;
  to: JobPostState;
  /** Required for `closed` (JL-REQ-002); ignored otherwise. */
  reason?: ManualCloseReason | null;
  /** Kept on the state event, never on the job (JL-REQ-002). */
  note?: string | null;
  /**
   * The states the move may start from, e.g. only `pending_approval` for an
   * approver's review; anything else is `invalid_transition`. Checked on the
   * row read here, before the RPC (which re-checks the move itself).
   */
  from?: readonly JobPostState[];
};

export type SetJobPostStateResult =
  | { ok: true; changed: boolean; from: JobPostState; state: JobPostState; jobId: string | null }
  | { ok: false; error: string }
  | ({ ok: false } & EntitlementActionError);

type RpcResult = {
  ok: boolean;
  reason?: string;
  job_id?: string | null;
  changed?: boolean;
  from?: JobPostState;
  to?: JobPostState;
  first_open?: boolean;
};

/**
 * Moves one of `company`'s job posts to another state (JL-REQ-005). Shared by
 * the server action and the recruiter agent; `company` must come from the
 * session. In order (spec §3):
 *
 * 1. the session permission (`jobs.publish` or `jobs.approve` on the job) and,
 *    when opening, the plan's limit, so the user gets the upgrade copy;
 * 2. on the first opening, the public `all_jobs` row (`ensurePublicJobRow`);
 * 3. `set_job_post_state`, which re-checks everything in one transaction and
 *    writes the event and the audit entry;
 * 4. only when it changed something: revalidation, the index ping and feed
 *    rebuild when the public status flipped, matching on the first opening
 *    (JL-REQ-010), and the approval emails in `after()` (JL-REQ-021).
 */
export async function setJobPostState(
  {
    supabase,
    company,
    user,
    actorKind = "user",
  }: {
    supabase: SupabaseClient<Database>;
    company: MyCompany;
    user?: { id: string };
    actorKind?: "user" | "agent";
  },
  input: SetJobPostStateInput,
): Promise<SetJobPostStateResult> {
  const { jobPostId, to } = input;
  if (typeof jobPostId !== "string" || !isUuid(jobPostId)) return { ok: false, error: JOB_STATE_REFUSALS.not_found };
  if (!isJobPostState(to)) return { ok: false, error: JOB_STATE_REFUSALS.invalid_transition };
  const reason = to === "closed" ? (input.reason ?? null) : null;
  if (to === "closed" && !isManualCloseReason(reason)) return { ok: false, error: JOB_STATE_REFUSALS.reason_required };
  const note = typeof input.note === "string" ? input.note.trim() || null : null;
  if (note && note.length > STATE_NOTE_MAX) return { ok: false, error: JOB_STATE_REFUSALS.note_too_long };

  if (!can(company, "jobs.publish", jobPostId) && !can(company, "jobs.approve", jobPostId)) {
    return { ok: false, error: JOB_STATE_REFUSALS.forbidden };
  }

  const { data: posting, error: loadError } = await supabase
    .from("job_postings")
    .select(`${PUBLIC_JOB_SOURCE_COLUMNS}, state, first_opened_at`)
    .eq("id", jobPostId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (loadError) return { ok: false, error: "Failed to load the job posting." };
  if (!posting) return { ok: false, error: JOB_STATE_REFUSALS.not_found };
  if (input.from && !input.from.includes(posting.state)) {
    return { ok: false, error: JOB_STATE_REFUSALS.invalid_transition };
  }

  if (to === "open" && posting.state !== "open") {
    try {
      await assertLimit(company.id, "active_job_posts");
    } catch (err) {
      if (err instanceof EntitlementError) return { ok: false, ...toEntitlementActionError(err) };
      throw err;
    }
  }

  // JL-REQ-006: a job that never opened gets (or refreshes) its public row
  // first. It stays inactive, so a refused open below leaves nothing listed.
  if (to === "open" && !posting.first_opened_at) {
    try {
      await preparePublicRow(posting, company);
    } catch (err) {
      reportError(`[job state] couldn't prepare the public row for ${posting.id}`, err);
      return { ok: false, error: JOB_STATE_REFUSALS.no_public_row };
    }
  }

  const { data, error } = await supabase.rpc("set_job_post_state", {
    p_job_post_id: posting.id,
    p_to: to,
    ...(reason ? { p_reason: reason } : {}),
    ...(note ? { p_note: note } : {}),
    p_actor_kind: actorKind,
  });
  if (error) return { ok: false, error: JOB_STATE_FAILED };
  const result = data as RpcResult | null;
  if (!result?.ok) return { ok: false, error: jobStateRefusalCopy(result?.reason) };

  const from = result.from ?? posting.state;
  const jobId = result.job_id ?? posting.job_id;
  if (result.changed) {
    await runSideEffects(
      { supabase, company, user },
      { postId: posting.id, jobId, from, to, firstOpen: !!result.first_open, title: posting.title, note },
    );
  }

  return { ok: true, changed: !!result.changed, from, state: to, jobId };
}

/** Creates the public row, or brings one left by an earlier attempt up to date. */
async function preparePublicRow(posting: PublicJobSource, company: MyCompany) {
  const service = createServiceRoleClient();
  if (!posting.job_id) {
    await ensurePublicJobRow(service, posting, company);
    return;
  }
  const { error } = await service
    .from("all_jobs")
    .update({ ...allJobsRowFrom(posting), updated_at: new Date().toISOString() })
    .eq("id", posting.job_id);
  if (error) throw new Error(error.message);
}

/**
 * JL-REQ-010, the part every move shares (the auto-close cron too): the
 * company pages are revalidated, and when the public status flipped, the
 * public page, the careers page, the index ping and the feeds. Never throws.
 * `rebuildFeed: false` lets a caller that moves many jobs queue one rebuild.
 */
export async function announceJobStateChange(
  move: { companyId: string; postId: string; jobId: string | null; from: JobPostState; to: JobPostState },
  { rebuildFeed = true }: { rebuildFeed?: boolean } = {},
) {
  const { companyId, postId, jobId, from, to } = move;
  const publicFlipped = from === "open" || to === "open";

  revalidatePath("/company/job-posts");
  revalidatePath(`/company/job-posts/${postId}`, "layout");
  if (jobId && publicFlipped) {
    revalidateTag(`job-${jobId}`);
    revalidateTag(careersCompanyTag(companyId));
    revalidatePath(`/jobs/${jobId}`);
    try {
      // MP-REQ-002/003: queued, so it never slows the request.
      await enqueueIndexPing({ jobId, reason: to === "open" ? "activated" : "closed" });
      if (rebuildFeed) await enqueueFeedRebuild();
    } catch (err) {
      reportError(`[job state] couldn't queue the ping or feed for ${postId}`, err);
    }
  }
}

/** JL-REQ-010: what follows a move that applied. Never throws: the move is saved. */
async function runSideEffects(
  deps: { supabase: SupabaseClient<Database>; company: MyCompany; user?: { id: string } },
  move: {
    postId: string;
    jobId: string | null;
    from: JobPostState;
    to: JobPostState;
    firstOpen: boolean;
    title: string;
    note: string | null;
  },
) {
  const { company, user } = deps;
  const { postId, jobId, from, to, firstOpen } = move;

  // JL-REQ-021: a submit, an approval or a request for changes emails someone.
  if (to === "pending_approval" || from === "pending_approval") {
    after(() =>
      sendApprovalEmails(createServiceRoleClient(), {
        companyId: company.id,
        postId,
        title: move.title,
        from,
        to,
        actorId: user?.id ?? null,
        note: move.note,
      }),
    );
  }

  await announceJobStateChange({ companyId: company.id, postId, jobId, from, to });

  // As upsertJobPosting does for open jobs: rank candidates once it's live.
  if (firstOpen) {
    try {
      await queueJobPostingRelevance(deps, postId);
    } catch (err) {
      reportError(`[job state] couldn't queue matching for ${postId}`, err);
    }
  }
}
