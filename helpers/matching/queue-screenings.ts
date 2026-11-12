import { reportError } from "@/helpers/posthog/report-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { assertAllowance } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { transitionMany } from "@/helpers/db/transition";
import { sendScreeningMessages } from "./enqueue-screenings";
import { needsScreening, needsScreeningAllowance, RESCREENABLE_STATES } from "./screening-view";

/**
 * What a re-screen for new candidate detail moves back to `queued`: every
 * state but `queued` itself, whose message is still pending. `processing`
 * included: the running worker's result is then refused, since its claim is
 * cleared (SM-REQ-003, SM-TEST-009).
 */
const REQUEUE_FROM = ["completed", "failed", "insufficient_info", "skipped_quota", "stale", "processing"] as const;

/**
 * Puts these applications' screenings in `queued` (SM-REQ-001): inserts the
 * ones with no row, and moves existing rows only from `from`, so a row a
 * worker claimed after the caller looked is left alone. Returns the ids that
 * were inserted or moved, which are the ones needing a message. Throws on a
 * database error.
 */
async function queueRows(
  admin: SupabaseClient<Database>,
  rows: { application_id: string; job_post_id: string }[],
  {
    companyId,
    requestedBy,
    from,
  }: { companyId: string; requestedBy: string; from: readonly [string, ...string[]] },
): Promise<string[]> {
  const now = new Date().toISOString();
  const queued = {
    status: "queued",
    attempts: 0,
    error_code: null,
    // RP-REQ-043: the worker charges this member, not "the system".
    requested_by: requestedBy,
    updated_at: now,
  };

  const { data: inserted, error: insertError } = await admin
    .from("application_screenings")
    .upsert(
      rows.map((row) => ({ ...row, company_id: companyId, ...queued })),
      { onConflict: "application_id", ignoreDuplicates: true },
    )
    .select("application_id");
  if (insertError) throw new Error(`Couldn't add screenings: ${insertError.message}`);

  const { applied: moved } = await transitionMany(
    admin,
    "application_screenings",
    { key: "application_id", ids: rows.map((row) => row.application_id) },
    { from, to: "queued", patch: { ...queued, claimed_at: null } },
  );

  const ids = new Set([...(inserted ?? []).map((row) => row.application_id), ...moved]);
  return rows.map((row) => row.application_id).filter((id) => ids.has(id));
}

/**
 * Sends the messages for rows just moved to `queued`; when that fails, moves
 * the ones still `queued` to `failed`, so none sits queued with no message,
 * and throws. Rows a worker claimed meanwhile are left alone.
 */
export async function sendScreeningsOrFail(
  admin: SupabaseClient<Database>,
  applicationIds: string[],
): Promise<void> {
  try {
    await sendScreeningMessages(admin, applicationIds);
  } catch (err) {
    await transitionMany(
      admin,
      "application_screenings",
      { key: "application_id", ids: applicationIds },
      { from: ["queued"], to: "failed", patch: { error_code: "worker_error", updated_at: new Date().toISOString() } },
    );
    throw err;
  }
}

/**
 * How many of a job's applications "Screen unscreened" would queue: no
 * screening yet, or a stale, failed, skipped or unscored one. Reads through RLS, so
 * the caller sees only jobs they have applicants.view on.
 */
export async function countUnscreenedApplications(
  supabase: SupabaseClient<Database>,
  jobPostId: string,
): Promise<number> {
  const [{ data: applications }, { data: screenings }] = await Promise.all([
    supabase.from("applications").select("id").eq("job_post_id", jobPostId),
    supabase.from("application_screenings").select("application_id, status").eq("job_post_id", jobPostId),
  ]);
  const statusOf = new Map((screenings ?? []).map((s) => [s.application_id, s.status]));
  return (applications ?? []).filter((a) => needsScreening(statusOf.get(a.id))).length;
}

export type QueueScreeningsResult =
  | { ok: true; queued: number }
  | { ok: false; reason: "not_found" | "load_failed" | "queue_failed" | "send_failed" }
  | { ok: false; reason: "entitlement"; error: EntitlementError };

/**
 * Queues a screening for every application to one of `company`'s jobs that
 * has none, or a stale, failed, skipped or unscored one (MT-REQ-005, MT-TASK-023).
 * Completed, queued and processing screenings are left alone, so calling it
 * twice queues nothing the second time. The read only picks the candidates and
 * whether the allowance is needed; the writes are guarded by state, so a row
 * a worker claims meanwhile isn't reset (SM-ISS-002). Shared by POST
 * /api/company/job-posts/[job_id]/screen and the agent's screenApplicants
 * tool; `supabase` and `company` come from the session.
 */
export async function queueJobScreenings(
  {
    supabase,
    company,
    user,
  }: { supabase: SupabaseClient<Database>; company: MyCompany; user: { id: string } },
  jobPostId: string,
): Promise<QueueScreeningsResult> {
  // Another company's job is "not_found", so its existence isn't confirmed.
  const { data: job } = await supabase
    .from("job_postings")
    .select("id")
    .eq("id", jobPostId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!job) return { ok: false, reason: "not_found" };

  // Ownership is settled above; the service role is only used from here on.
  const admin = createServiceRoleClient();

  const { data: applications, error: applicationsError } = await admin
    .from("applications")
    .select("id")
    .eq("job_post_id", jobPostId);
  const { data: screenings, error: screeningsError } = await admin
    .from("application_screenings")
    .select("application_id, status")
    .eq("job_post_id", jobPostId);
  if (applicationsError || screeningsError) {
    reportError("[job-posts/screen] couldn't load applications", applicationsError ?? screeningsError);
    return { ok: false, reason: "load_failed" };
  }

  const statusOf = new Map((screenings ?? []).map((s) => [s.application_id, s.status]));
  const toQueue = (applications ?? [])
    .map((application) => application.id)
    .filter((id) => needsScreening(statusOf.get(id)));

  if (toQueue.length === 0) return { ok: true, queued: 0 };

  // The worker charges each one; any it can't pay for become skipped_quota.
  const needsAllowance = toQueue.some((id) => needsScreeningAllowance(statusOf.get(id)));
  if (needsAllowance) {
    try {
      // RP-REQ-042: the member's own cap too, before anything is queued.
      await assertAllowance(company.id, "screenings", 1, user.id);
    } catch (err) {
      if (err instanceof EntitlementError) return { ok: false, reason: "entitlement", error: err };
      throw err;
    }
  }

  let queued: string[];
  try {
    queued = await queueRows(
      admin,
      toQueue.map((applicationId) => ({ application_id: applicationId, job_post_id: jobPostId })),
      { companyId: company.id, requestedBy: user.id, from: RESCREENABLE_STATES },
    );
  } catch (err) {
    reportError("[job-posts/screen] couldn't queue screenings", err);
    return { ok: false, reason: "queue_failed" };
  }

  try {
    await sendScreeningsOrFail(admin, queued);
  } catch (err) {
    // The rows are failed now, and the next "Screen unscreened" picks them up.
    reportError("[job-posts/screen] couldn't send screening messages", err);
    return { ok: false, reason: "send_failed" };
  }

  return { ok: true, queued: queued.length };
}

/**
 * Screens these applications again, whatever their screening's status
 * (BI-REQ-008: a candidate got a resume). The worker charges a screening once
 * per application, so a re-screen of one already charged is free. A running
 * screening is re-queued too, and its result refused (SM-TEST-009); one
 * already `queued` keeps its pending message, which reads the candidate when
 * it runs. Returns how many were queued. Throws if the queue can't be
 * reached, after marking them failed. `admin` is the service role: the caller has
 * already checked the applications are the session company's.
 */
export async function requeueScreenings(
  admin: SupabaseClient<Database>,
  {
    companyId,
    applications,
    requestedBy,
  }: { companyId: string; applications: { id: string; job_post_id: string | null }[]; requestedBy: string },
): Promise<number> {
  const rows = applications
    .filter((a): a is { id: string; job_post_id: string } => Boolean(a.job_post_id))
    .map((a) => ({ application_id: a.id, job_post_id: a.job_post_id }));
  if (rows.length === 0) return 0;
  const queued = await queueRows(admin, rows, { companyId, requestedBy, from: REQUEUE_FROM });
  await sendScreeningsOrFail(admin, queued);
  return queued.length;
}
