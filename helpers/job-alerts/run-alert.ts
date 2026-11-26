import "server-only";
import React from "react";
import { render } from "react-email";
import type { SupabaseClient } from "@supabase/supabase-js";
import JobAlertEmail, { jobAlertSubject } from "@/emails/JobAlertEmail";
import { searchJobs } from "@/helpers/jobs/search-jobs";
import { reportError } from "@/helpers/posthog/report-error";
import type { Database } from "@/utils/types/database.types";
import { deploymentUrl } from "@/utils/formatters";
import type { AlertFilters } from "./filters";
import { alertWindowStart } from "./due";
import { alertSearchParams } from "./search-params";
import { jobAlertSearchUrl } from "./paths";
import { alertOneClickPauseUrl, alertPauseUrl } from "./pause-token";

/** Jobs per email (JA-REQ-035). */
export const ALERT_EMAIL_JOBS = 10;
/** The most recent applications left out of an alert. Older ones are unlikely to be reposted. */
const APPLIED_LOOKBACK = 500;

export type RunnableAlert = {
  id: string;
  user_id: string;
  name: string;
  url: string | null;
  filters: AlertFilters;
  frequency: "daily" | "weekly";
  created_at: string;
  last_checked_at: string | null;
  email: string;
  fullName: string | null;
};

export type AlertEmail = {
  toEmail: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  headers: Record<string, string>;
};

export type RunJobAlertDeps = {
  /** The run's start: the window ends here and `last_checked_at` is set to it. */
  now: Date;
  /** Service role: the worker reads every user's alerts and writes the derived columns. */
  supabase: SupabaseClient<Database>;
  send: (email: AlertEmail) => Promise<void>;
};

export type RunJobAlertResult =
  | { ok: true; sent: boolean; jobs: number; total: number }
  | { ok: false; error: string };


/**
 * One alert's run (JA-REQ-031–033): the new, unapplied jobs posted since the
 * window start, emailed when there are any. Written so it can move to a pgmq
 * worker unchanged (JA-REQ-034). `last_checked_at` moves only after a
 * successful send (or when there was nothing to send), so a failed send is
 * retried with the same window on the next run.
 */
export async function runJobAlert(alert: RunnableAlert, { now, supabase, send }: RunJobAlertDeps): Promise<RunJobAlertResult> {
  const since = alertWindowStart(alert, now);

  const { data: applied, error: appliedError } = await supabase
    .from("applications")
    .select("all_jobs_id")
    .eq("applicant_user_id", alert.user_id)
    .not("all_jobs_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(APPLIED_LOOKBACK);
  if (appliedError) return { ok: false, error: `applications: ${appliedError.message}` };
  const excludeJobIds = [...new Set((applied ?? []).map((a) => a.all_jobs_id).filter((id): id is string => !!id))];

  const result = await searchJobs(supabase, null, {
    ...alertSearchParams(alert.filters),
    limit: ALERT_EMAIL_JOBS,
    createdSince: since,
    excludeJobIds,
  });
  if (!result.ok) return { ok: false, error: `search: ${result.error}` };

  const jobs = result.data.slice(0, ALERT_EMAIL_JOBS);
  const total = Math.max(result.totalCount, jobs.length);

  if (jobs.length === 0) {
    const error = await writeBack(supabase, alert, { last_checked_at: now.toISOString() });
    return error ? { ok: false, error } : { ok: true, sent: false, jobs: 0, total: 0 };
  }

  const baseUrl = deploymentUrl();
  const pauseUrl = alertPauseUrl(alert.id);
  const element = React.createElement(JobAlertEmail, {
    userName: alert.fullName?.trim() || alert.email.split("@")[0],
    alertId: alert.id,
    alertName: alert.name,
    frequency: alert.frequency,
    jobs: jobs.map((job) => ({
      id: job.id,
      job_name: job.job_name,
      company_name: job.company_name,
      locations: job.locations,
      salary_range: job.salary_range,
      created_at: job.created_at,
    })),
    total,
    baseUrl,
    seeAllUrl: jobAlertSearchUrl(baseUrl, alert.url ?? "/jobs", alert.id),
    pauseUrl,
  });

  try {
    await send({
      toEmail: alert.email,
      subject: jobAlertSubject(total, alert.name),
      htmlContent: await render(element),
      textContent: await render(element, { plainText: true }),
      // Gmail's and Outlook's unsubscribe button (RFC 8058) posts to the pause page.
      headers: {
        "List-Unsubscribe": `<${alertOneClickPauseUrl(alert.id)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  } catch (err) {
    return { ok: false, error: `send: ${err instanceof Error ? err.message : String(err)}` };
  }

  const error = await writeBack(supabase, alert, {
    last_checked_at: now.toISOString(),
    last_sent_at: new Date().toISOString(),
  });
  // The email went out: it counts as sent even if the write-back failed (the
  // next run would then send these jobs again, so it's reported).
  if (error) reportError("[job alerts] sent, but couldn't record it", { alertId: alert.id, error });
  return { ok: true, sent: true, jobs: jobs.length, total };
}

async function writeBack(
  supabase: SupabaseClient<Database>,
  alert: RunnableAlert,
  patch: { last_checked_at: string; last_sent_at?: string },
): Promise<string | null> {
  const { error } = await supabase.from("bookmarks").update(patch).eq("id", alert.id).eq("user_id", alert.user_id);
  return error ? `write-back: ${error.message}` : null;
}
