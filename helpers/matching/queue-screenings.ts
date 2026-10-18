import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { assertAllowance } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendScreeningMessages } from "./enqueue-screenings";

/** Statuses that "Screen unscreened" picks up again. */
const RESCREENABLE = new Set(["stale", "failed", "skipped_quota"]);

/**
 * How many of a job's applications "Screen unscreened" would queue: no
 * screening yet, or a stale, failed or skipped one. Reads through RLS, so
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
  return (applications ?? []).filter((a) => {
    const status = statusOf.get(a.id);
    return status === undefined || RESCREENABLE.has(status);
  }).length;
}

export type QueueScreeningsResult =
  | { ok: true; queued: number }
  | { ok: false; reason: "not_found" | "load_failed" | "queue_failed" | "send_failed" }
  | { ok: false; reason: "entitlement"; error: EntitlementError };

/**
 * Queues a screening for every application to one of `company`'s jobs that
 * has none, or a stale, failed or skipped one (MT-REQ-005, MT-TASK-023).
 * Completed, queued and processing screenings are left alone, so calling it
 * twice queues nothing the second time. Shared by POST
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
    console.error("[job-posts/screen] couldn't load applications", applicationsError ?? screeningsError);
    return { ok: false, reason: "load_failed" };
  }

  const statusOf = new Map((screenings ?? []).map((s) => [s.application_id, s.status]));
  const toQueue = (applications ?? [])
    .map((application) => application.id)
    .filter((id) => {
      const status = statusOf.get(id);
      return status === undefined || RESCREENABLE.has(status);
    });

  if (toQueue.length === 0) return { ok: true, queued: 0 };

  // Re-screens are free (the charge ref is the application), so only
  // applications never charged need the allowance. The worker charges each
  // one; any it can't pay for become skipped_quota.
  const needsAllowance = toQueue.some((id) => {
    const status = statusOf.get(id);
    return status === undefined || status === "skipped_quota";
  });
  if (needsAllowance) {
    try {
      // RP-REQ-042: the member's own cap too, before anything is queued.
      await assertAllowance(company.id, "screenings", 1, user.id);
    } catch (err) {
      if (err instanceof EntitlementError) return { ok: false, reason: "entitlement", error: err };
      throw err;
    }
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await admin.from("application_screenings").upsert(
    toQueue.map((applicationId) => ({
      application_id: applicationId,
      job_post_id: jobPostId,
      company_id: company.id,
      status: "queued",
      attempts: 0,
      error_code: null,
      // RP-REQ-043: the worker charges this member, not "the system".
      requested_by: user.id,
      updated_at: now,
    })),
    { onConflict: "application_id" },
  );
  if (upsertError) {
    console.error("[job-posts/screen] couldn't queue screenings", upsertError.message);
    return { ok: false, reason: "queue_failed" };
  }

  try {
    await sendScreeningMessages(admin, toQueue);
  } catch (err) {
    // Don't leave rows "queued" with no message: failed rows get picked up
    // by the next "Screen unscreened".
    console.error("[job-posts/screen] couldn't send screening messages", err);
    await admin
      .from("application_screenings")
      .update({ status: "failed", error_code: "worker_error", updated_at: now })
      .in("application_id", toQueue);
    return { ok: false, reason: "send_failed" };
  }

  return { ok: true, queued: toQueue.length };
}
