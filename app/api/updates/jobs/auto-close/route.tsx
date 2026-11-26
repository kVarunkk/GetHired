import { after, NextRequest, NextResponse } from "next/server";
import { render } from "react-email";
import JobAutoClosedEmail from "@/emails/JobAutoClosedEmail";
import JobClosingSoonEmail from "@/emails/JobClosingSoonEmail";
import { CLOSING_SOON_DAYS } from "@/helpers/company-dashboard/summary";
import { enqueueFeedRebuild } from "@/helpers/distribution/feed-queue";
import { formatClosingDate } from "@/helpers/jobs/closing-date";
import { jobTeamEmails } from "@/helpers/jobs/job-team-emails";
import { jobPostPath } from "@/helpers/jobs/paths";
import { announceJobStateChange } from "@/helpers/jobs/set-job-post-state";
import { reportError } from "@/helpers/posthog/report-error";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { deploymentUrl, INTERNAL_API_SECRET } from "@/utils/formatters";

type ClosedJob = { job_post_id: string; job_id: string | null; company_id: string; title: string; closes_at: string };
type ClosingSoonJob = { job_post_id: string; company_id: string; title: string; closes_at: string };

/**
 * JL-REQ-015 / JL-REQ-017 (JLT-042, JLT-045): closes every job whose closing
 * date has passed in its company's time zone (`close_due_job_posts`), runs
 * the side effects of a move for each (JL-REQ-010), and emails each job's
 * team. Then claims the jobs closing within CLOSING_SOON_DAYS and reminds
 * their teams. Called hourly by pg_cron (`jobs-auto-close`) with
 * X-Internal-Secret. Emails go out in `after()`; failures are reported
 * through `sendEmailForStatusUpdate`.
 */
export async function POST(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceRoleClient();

  const { data: closedRows, error: closeError } = await service.rpc("close_due_job_posts");
  if (closeError) {
    reportError("[auto-close] close_due_job_posts failed", closeError.message);
    await sendEmailForStatusUpdate(`Job auto-close failed: ${closeError.message}`);
    return NextResponse.json({ message: "Couldn't close due jobs." }, { status: 500 });
  }
  const closed = (closedRows ?? []) as ClosedJob[];

  for (const job of closed) {
    await announceJobStateChange(
      // The function closes open and paused jobs; either way the public row
      // goes (or stays) inactive, so the ping and careers page are refreshed.
      { companyId: job.company_id, postId: job.job_post_id, jobId: job.job_id, from: "open", to: "closed" },
      { rebuildFeed: false },
    );
  }
  if (closed.length > 0) {
    try {
      await enqueueFeedRebuild();
    } catch (err) {
      reportError("[auto-close] couldn't queue the feed rebuild", err);
    }
  }

  // Claimed (marked reminded) in the same statement, so a failed send isn't retried.
  const { data: soonRows, error: soonError } = await service.rpc("claim_closing_soon_job_posts", {
    p_days: CLOSING_SOON_DAYS,
  });
  if (soonError) reportError("[auto-close] claim_closing_soon_job_posts failed", soonError.message);
  const closingSoon = (soonRows ?? []) as ClosingSoonJob[];

  if (closed.length > 0 || closingSoon.length > 0) {
    after(async () => {
      const failures: string[] = [];
      for (const job of closed) {
        const message = (
          <JobAutoClosedEmail
            jobTitle={job.title}
            closedOn={formatClosingDate(job.closes_at)}
            jobUrl={`${deploymentUrl()}${jobPostPath(job.job_post_id)}`}
          />
        );
        const ok = await emailTeam(service, job, `${job.title} closed on its closing date`, message);
        if (!ok) failures.push(`closed ${job.job_post_id}`);
      }
      for (const job of closingSoon) {
        const closesOn = formatClosingDate(job.closes_at);
        const message = (
          <JobClosingSoonEmail
            jobTitle={job.title}
            closesOn={closesOn}
            editUrl={`${deploymentUrl()}${jobPostPath(job.job_post_id)}/edit`}
          />
        );
        const ok = await emailTeam(service, job, `${job.title} closes on ${closesOn}`, message);
        if (!ok) failures.push(`closing soon ${job.job_post_id}`);
      }
      if (failures.length > 0) {
        await sendEmailForStatusUpdate(`Job auto-close: couldn't email the team for ${failures.join(", ")}.`);
      }
    });
  }

  return NextResponse.json({ closed: closed.length, reminded: closingSoon.length });
}

/** Emails one job's owners and hiring team. False when anything failed. */
async function emailTeam(
  service: ReturnType<typeof createServiceRoleClient>,
  job: { job_post_id: string; company_id: string },
  subject: string,
  message: React.ReactElement,
): Promise<boolean> {
  try {
    const recipients = await jobTeamEmails(service, job.company_id, job.job_post_id);
    if (recipients.length === 0) return true;
    const [htmlContent, textContent] = await Promise.all([render(message), render(message, { plainText: true })]);
    let ok = true;
    for (const toEmail of recipients) {
      try {
        await sendEmail({ toEmail, subject, htmlContent, textContent });
      } catch (err) {
        reportError("[auto-close] email failed for", job.job_post_id, err);
        ok = false;
      }
    }
    return ok;
  } catch (err) {
    reportError("[auto-close] couldn't email the team of", job.job_post_id, err);
    return false;
  }
}

export const GET = POST;
