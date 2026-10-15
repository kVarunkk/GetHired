import { NextRequest, NextResponse } from "next/server";
import { requireCompany } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";
import { assertAllowance } from "@/helpers/billing/entitlements";
import { EntitlementError, toEntitlementResponse } from "@/helpers/billing/errors";
import { sendScreeningMessages } from "@/helpers/matching/enqueue-screenings";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/** Statuses that "Screen unscreened" picks up again. */
const RESCREENABLE = new Set(["stale", "failed", "skipped_quota"]);

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

/**
 * Queues a screening for every application to one of the company's jobs that
 * has none, or a stale, failed or skipped one (MT-REQ-005, MT-TASK-023).
 * Completed, queued and processing screenings are left alone, so calling it
 * twice queues nothing the second time. Returns `{ queued }`, or a 402 when
 * new screenings are needed and the plan can't pay for even one.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ job_id: string }> },
) {
  const auth = await requireCompany();
  if (!auth.ok) return auth.response;
  const { supabase, company } = auth;

  const { job_id: jobPostId } = await params;
  if (!isUuid(jobPostId)) return notFound();

  // Another company's job is a 404, so its existence isn't confirmed.
  const { data: job } = await supabase
    .from("job_postings")
    .select("id")
    .eq("id", jobPostId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!job) return notFound();

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
    return NextResponse.json({ error: "Couldn't load the applications." }, { status: 500 });
  }

  const statusOf = new Map((screenings ?? []).map((s) => [s.application_id, s.status]));
  const toQueue = (applications ?? [])
    .map((application) => application.id)
    .filter((id) => {
      const status = statusOf.get(id);
      return status === undefined || RESCREENABLE.has(status);
    });

  if (toQueue.length === 0) return NextResponse.json({ queued: 0 });

  // Re-screens are free (the charge ref is the application), so only
  // applications never charged need the allowance. The worker charges each
  // one; any it can't pay for become skipped_quota.
  const needsAllowance = toQueue.some((id) => {
    const status = statusOf.get(id);
    return status === undefined || status === "skipped_quota";
  });
  if (needsAllowance) {
    try {
      await assertAllowance(company.id, "screenings", 1);
    } catch (err) {
      if (err instanceof EntitlementError) return toEntitlementResponse(err);
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
      updated_at: now,
    })),
    { onConflict: "application_id" },
  );
  if (upsertError) {
    console.error("[job-posts/screen] couldn't queue screenings", upsertError.message);
    return NextResponse.json({ error: "Couldn't queue the screenings." }, { status: 500 });
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
    return NextResponse.json({ error: "Couldn't queue the screenings. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ queued: toQueue.length });
}
