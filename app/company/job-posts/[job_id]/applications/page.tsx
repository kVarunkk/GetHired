import { reportError } from "@/helpers/posthog/report-error";
import Link from "next/link";
import { answerFilterQuestions } from "@/helpers/applications/answer-filters";
import { readApplicationForm } from "@/helpers/jobs/application-form-schema";
import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import FunnelStrip from "@/components/pipeline/FunnelStrip";
import PipelineBoard from "@/components/pipeline/PipelineBoard";
import PipelineList from "@/components/pipeline/PipelineList";
import { isUuid } from "@/helpers/agent/auth";
import { getMemberLimit } from "@/helpers/billing/entitlements";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { getInterviewConfig } from "@/helpers/interview/screening/config";
import { DEFAULT_DURATION_MINUTES } from "@/helpers/interview/screening/schemas";
import { getInterviewSummaries } from "@/helpers/interview/screening/summaries";
import { loadBoard } from "@/helpers/pipeline/board";
import { getJobFunnel } from "@/helpers/pipeline/funnel";
import { RECRUITER_CANDIDATE_COLUMNS } from "@/helpers/profiles/candidate-columns";
import { createClient } from "@/lib/supabase/server";
import type { PipelineBoardData } from "@/utils/types/pipeline.types";
import { cn } from "@/utils/utils";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Applications",
};

/**
 * A job's applications (PL-TASK-004, PL-TASK-010): the funnel strip and the
 * List or Board view (`?view=list|board`). A section of the job's layout.
 */
export default async function JobApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ job_id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  try {
    const { job_id } = await params;
    if (!isUuid(job_id)) notFound();
    const view = (await searchParams).view === "board" ? "board" : "list";

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company) notFound();

    // Scoped to the session company: another company's job is a 404.
    const { data: job, error } = await supabase
      .from("job_postings")
      .select(
        `
          id,
          title,
          company_id,
          questions,
          application_form,
          applications(*, user_info(${RECRUITER_CANDIDATE_COLUMNS}), job_postings(*), application_screenings(status, fit_score, recommendation), application_knockouts(failed, reasons, action_taken))
        ` as const,
      )
      .eq("id", job_id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    if (!job) notFound();

    const canViewInterviews = can(company, "interviews.view", job.id);
    const canMove = can(company, "pipeline.move", job.id);
    const [{ data: stages, error: stagesError }, { data: templates }, funnel, screeningCap, interviewData] = await Promise.all([
      supabase
        .from("pipeline_stages")
        .select("id, name, kind")
        .eq("company_id", company.id)
        .eq("archived", false)
        .order("position", { ascending: true }),
      supabase
        .from("company_email_templates")
        .select("id, purpose, name, subject, body_md, is_default")
        .eq("company_id", company.id)
        .order("name", { ascending: true }),
      // The funnel strip (PL-TASK-050). It's extra: a failure only hides it.
      getJobFunnel(supabase, job.id).catch((err) => {
        reportError("Failed to load the job funnel:", err);
        return null;
      }),
      // RP-REQ-044: the member's own cap, next to the Screen button.
      getMemberLimit(company.id, "screenings", user!.id).catch(() => null),
      // SIT-062: the Interview column and bulk invites. Extra: a failure hides them.
      canViewInterviews
        ? Promise.all([getInterviewConfig(supabase, job.id), getInterviewSummaries(supabase, job.id)]).catch((err) => {
            reportError("Failed to load the job's interviews:", err);
            return null;
          })
        : null,
    ]);
    if (stagesError) throw stagesError;

    let board: PipelineBoardData | null = null;
    if (view === "board") {
      const result = await loadBoard({ supabase, company }, job.id);
      if (!result.ok) notFound();
      board = result.data;
    }

    const applications = job.applications ?? [];
    const [interviewConfig, interviews] = interviewData ?? [null, undefined];
    // Show the column once the interview is set up or anyone was invited.
    const showInterviews = !!interviews && (!!interviewConfig || Object.keys(interviews).length > 0);
    // Shown while the interview is off too: the dialog then points to its setup.
    const interviewInvite =
      interviewData && can(company, "interviews.manage", job.id)
        ? {
            durationMinutes: interviewConfig?.duration_minutes ?? DEFAULT_DURATION_MINUTES,
            enabled: !!interviewConfig?.enabled,
          }
        : undefined;

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title={`Applications (${applications.length})`}
          description="Everyone who applied to this job, by stage."
          actions={
            <nav aria-label="Applications view" className="flex rounded-md border p-0.5 text-sm">
              {(["list", "board"] as const).map((option) => (
                <Link
                  key={option}
                  href={`?view=${option}`}
                  aria-current={view === option ? "page" : undefined}
                  className={cn(
                    "rounded px-3 py-1 capitalize text-muted-foreground",
                    view === option && "bg-muted font-medium text-foreground",
                  )}
                >
                  {option}
                </Link>
              ))}
            </nav>
          }
        />

        {funnel && funnel.total > 0 && <FunnelStrip stages={funnel.stages} />}

        {board ? (
          <PipelineBoard
            jobPostId={job.id}
            initial={board}
            templates={templates ?? []}
            canMove={canMove}
          />
        ) : (
          <PipelineList
            data={applications}
            jobPostId={job.id}
            stages={stages ?? []}
            templates={templates ?? []}
            screeningCap={screeningCap && { limit: screeningCap.limit, remaining: screeningCap.remaining }}
            answerQuestions={answerFilterQuestions(readApplicationForm(job.application_form, job.questions))}
            interviews={showInterviews ? interviews : undefined}
            interviewInvite={interviewInvite}
            canMove={canMove}
          />
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
