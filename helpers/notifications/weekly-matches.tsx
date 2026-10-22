import "server-only";
import { reportError } from "@/helpers/posthog/report-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import { render } from "react-email";
import WeeklyMatchesEmail, { type WeeklyMatchesJob } from "@/emails/WeeklyMatchesEmail";
import { parseStoredExplanation } from "@/helpers/matching/schemas";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import type { Database } from "@/utils/types/database.types";
import { settingsUrl } from "./new-applicants";

export const WEEKLY_MATCHES_QUEUE = "weekly_matches_queue";
export const WEEKLY_MAX_READS = 3;
export type WeeklyMatchesMessage = { companyId: string };

const WEEK_MS = 7 * 24 * 60 * 60_000;
const TOP = 3;

type Admin = SupabaseClient<Database>;

/** A week before `now`: the cron runs on Mondays, so "since last Monday". */
export const weekStart = (now = Date.now()) => new Date(now - WEEK_MS).toISOString();

/**
 * Per active job of the company: the matches created this week and the top 3
 * by `match_score`. Jobs without new matches are left out.
 */
export async function loadWeeklyMatches(
  admin: Admin,
  companyId: string,
  since: string,
): Promise<WeeklyMatchesJob[]> {
  const { data: jobs, error } = await admin
    .from("job_postings")
    .select("id, title")
    .eq("company_id", companyId)
    .eq("status", "active");
  if (error) throw new Error(`Couldn't load jobs: ${error.message}`);

  const result: WeeklyMatchesJob[] = [];
  for (const job of jobs ?? []) {
    const { count, error: countError } = await admin
      .from("job_relevant_profiles")
      .select("id", { count: "exact", head: true })
      .eq("job_posting_id", job.id)
      .gte("created_at", since);
    if (countError) throw new Error(`Couldn't count matches: ${countError.message}`);
    if (!count) continue;

    const { data: top, error: topError } = await admin
      .from("job_relevant_profiles")
      .select("match_score, explanation, user_info(full_name)")
      .eq("job_posting_id", job.id)
      .gte("created_at", since)
      .order("match_score", { ascending: false, nullsFirst: false })
      .limit(TOP);
    if (topError) throw new Error(`Couldn't load matches: ${topError.message}`);

    result.push({
      title: job.title,
      url: `${deploymentUrl()}/company/job-posts/${job.id}`,
      newMatches: count,
      top: (top ?? []).map((m) => ({
        firstName: m.user_info?.full_name?.trim().split(/\s+/)[0] || "A candidate",
        matchScore: m.match_score,
        summary: parseStoredExplanation(m.explanation)?.summary ?? null,
      })),
    });
  }
  return result;
}

export async function sendWeeklyMatches({
  to,
  companyName,
  jobs,
}: {
  to: string;
  companyName: string;
  jobs: WeeklyMatchesJob[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const email = <WeeklyMatchesEmail companyName={companyName} jobs={jobs} settingsUrl={settingsUrl()} />;
    const total = jobs.reduce((sum, job) => sum + job.newMatches, 0);
    const [htmlContent, textContent] = await Promise.all([render(email), render(email, { plainText: true })]);
    await sendEmail({
      toEmail: to,
      subject: `${total} new matched candidate${total === 1 ? "" : "s"} this week`,
      htmlContent,
      textContent,
    });
    return { ok: true };
  } catch (err) {
    reportError("Error sending the weekly matches email:", err);
    return { ok: false, error: "Failed to send email" };
  }
}
