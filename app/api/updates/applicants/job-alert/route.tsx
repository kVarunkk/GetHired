import { after, NextResponse } from "next/server";
import { headers } from "next/headers";
import { reportError } from "@/helpers/posthog/report-error";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { dueCheckedBefore, isAlertDue } from "@/helpers/job-alerts/due";
import type { AlertFilters } from "@/helpers/job-alerts/filters";
import { runJobAlert, type RunnableAlert } from "@/helpers/job-alerts/run-alert";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";
import { PostHogEvent } from "@/utils/types";

/** Alerts run at once. Past ~500 due alerts this moves to pgmq (JA-REQ-034). */
const BATCH_SIZE = 5;

type AlertReport = { id: string; ok: boolean; sent: boolean; jobs: number; error?: string };

/**
 * JA-REQ-030: the daily `job-alerts` cron. Picks the active alerts that are
 * due (daily ones checked more than 20 hours ago; weekly ones the same, on
 * Mondays UTC), runs each through `runJobAlert` in `after()`, and emails the
 * admin a report by alert id (never an email address, JA-REQ-038).
 */
export async function GET() {
  const headersList = await headers();
  if (headersList.get("x-internal-secret") !== INTERNAL_API_SECRET) {
    reportError("CRON Unauthorized Access Attempt: Secret Mismatch");
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  const now = new Date();
  const supabase = createServiceRoleClient();

  try {
    // Rows without a key are pre-backfill bookmarks: their `filters` is empty
    // and would alert on every job (JAT-071 fills them in).
    const { data: rows, error } = await supabase
      .from("bookmarks")
      .select(
        "id, user_id, name, url, filters, frequency, created_at, last_checked_at, user_info ( email, full_name )",
      )
      .eq("is_alert_on", true)
      .not("filters_key", "is", null)
      .or(`last_checked_at.is.null,last_checked_at.lt.${dueCheckedBefore(now).toISOString()}`);
    if (error) throw new Error(`Database fetch failed: ${error.message}`);

    const due: RunnableAlert[] = [];
    for (const row of rows ?? []) {
      const info = row.user_info as { email: string | null; full_name: string | null } | null;
      if (!row.user_id || !info?.email || !isAlertDue(row, now)) continue;
      due.push({
        id: row.id,
        user_id: row.user_id,
        name: row.name,
        url: row.url,
        filters: (row.filters ?? {}) as AlertFilters,
        frequency: row.frequency === "daily" ? "daily" : "weekly",
        created_at: row.created_at,
        last_checked_at: row.last_checked_at,
        email: info.email,
        fullName: info.full_name,
      });
    }

    if (due.length === 0) {
      return NextResponse.json({ success: true, message: "No job alerts are due." });
    }

    after(async () => {
      const reports: AlertReport[] = [];
      for (let i = 0; i < due.length; i += BATCH_SIZE) {
        const batch = due.slice(i, i + BATCH_SIZE);
        const settled = await Promise.allSettled(
          batch.map(async (alert) => {
            const result = await runJobAlert(alert, {
              now,
              supabase,
              send: (email) => sendEmail(email),
            });
            if (result.ok && result.sent) {
              await eventCaptureServer({
                event: PostHogEvent.JobAlertEmailSent,
                distinctId: alert.user_id,
                properties: { alert_id: alert.id, jobs: result.jobs, total: result.total, frequency: alert.frequency },
              });
            }
            return result;
          }),
        );
        settled.forEach((outcome, index) => {
          const id = batch[index].id;
          if (outcome.status === "rejected") {
            reportError("[job alert] run failed", outcome.reason);
            reports.push({ id, ok: false, sent: false, jobs: 0, error: String(outcome.reason) });
          } else if (!outcome.value.ok) {
            reports.push({ id, ok: false, sent: false, jobs: 0, error: outcome.value.error });
          } else {
            reports.push({ id, ok: true, sent: outcome.value.sent, jobs: outcome.value.jobs });
          }
        });
      }
      await sendEmailForStatusUpdate(jobAlertReport(reports, now));
    });

    return NextResponse.json({
      success: true,
      message: `Job alert processing started for ${due.length} alerts. Results will be emailed to admin.`,
    });
  } catch (e) {
    reportError("Critical processing error:", e);
    const errorMsg = e instanceof Error ? e.message : String(e);
    await sendEmailForStatusUpdate(`CRITICAL FAILURE IN JOB ALERTS:\n${errorMsg}`);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

/** The admin report: counts, then failures by alert id. Error text is scrubbed of email addresses. */
function jobAlertReport(reports: AlertReport[], now: Date): string {
  const sent = reports.filter((r) => r.sent);
  const failed = reports.filter((r) => !r.ok);
  const scrub = (text = "") => text.replace(/[^\s@<>()"']+@[^\s@<>()"']+/g, "[email]");
  return [
    `JOB ALERT EXECUTION REPORT (${now.toISOString()})`,
    `Alerts checked: ${reports.length}`,
    `Emails sent: ${sent.length}`,
    `Jobs sent: ${sent.reduce((sum, r) => sum + r.jobs, 0)}`,
    `Failures: ${failed.length}`,
    "-------------------------------------------------------",
    ...failed.map((f) => `- alert ${f.id}: ${scrub(f.error)}`),
  ].join("\n");
}
