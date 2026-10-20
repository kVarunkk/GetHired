import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { FileText, History, Mic, Sparkles, StickyNote, User } from "lucide-react";
import Error from "@/components/Error";
import EntityLayout from "@/components/EntityLayout";
import type { EntityNavItem } from "@/components/EntityNav";
import PageHeader from "@/components/PageHeader";
import ScreeningInterviewActions from "@/components/interviews/ScreeningInterviewActions";
import StagePicker from "@/components/pipeline/StagePicker";
import { can } from "@/helpers/companies/permissions";
import {
  applicationPath,
  loadApplicationFrame,
  loadApplicationInterview,
} from "@/helpers/applications/application-page";
import { isOpenInterview } from "@/helpers/interview/screening/summary-view";
import { DEFAULT_DURATION_MINUTES } from "@/helpers/interview/screening/schemas";

/**
 * An application's frame: the sections sidebar (answers, candidate, fit
 * screening, AI interview, notes, activity) and the header with the stage
 * picker and the AI interview's actions.
 */
export default async function ApplicationLayout({
  params,
  children,
}: {
  params: Promise<{ application_id: string }>;
  children: ReactNode;
}) {
  try {
    const { application_id } = await params;
    const frame = await loadApplicationFrame(application_id);
    if (!frame) notFound();
    const { supabase, company, application, jobId } = frame;

    // RLS: only the company's members can read its stages and templates.
    const companyId = application.job_postings?.company_id;
    const [[{ data: allStages }, { data: templates }], interview] = await Promise.all([
      companyId
        ? Promise.all([
            supabase
              .from("pipeline_stages")
              .select("id, name, kind, archived")
              .eq("company_id", companyId)
              .order("position", { ascending: true }),
            // For the stage picker's move dialog, which can email the candidate.
            supabase
              .from("company_email_templates")
              .select("id, purpose, name, subject, body_md, is_default")
              .eq("company_id", companyId)
              .order("name", { ascending: true }),
          ])
        : [{ data: null }, { data: null }],
      loadApplicationInterview(application.id),
    ]);
    const stages = allStages?.filter((s) => !s.archived) ?? null;
    const stageKind = allStages?.find((s) => s.id === application.stage_id)?.kind ?? null;
    const screeningInterview = interview.interview;
    const candidateName = application.user_info?.full_name || "Applicant details";

    const base = applicationPath(application.id);
    const items: EntityNavItem[] = [
      { href: base, label: "Answers", icon: <FileText />, exact: true },
      { href: `${base}/candidate`, label: "Candidate", icon: <User /> },
    ];
    if (jobId) items.push({ href: `${base}/screening`, label: "Fit screening", icon: <Sparkles /> });
    if (screeningInterview) items.push({ href: `${base}/interview`, label: "AI interview", icon: <Mic /> });
    items.push(
      { href: `${base}/notes`, label: "Notes", icon: <StickyNote /> },
      { href: `${base}/activity`, label: "Activity", icon: <History /> },
    );

    return (
      <EntityLayout
        nav={{
          label: "Application sections",
          title: candidateName,
          backHref: "/company/applications",
          backLabel: "Applications",
          items,
        }}
        header={
          <PageHeader
            eyebrow="Application"
            title={<span className="[overflow-wrap:anywhere]">{candidateName}</span>}
            description={
              application.job_postings?.title && (
                <span className="[overflow-wrap:anywhere]">
                  Applied for{" "}
                  <Link
                    href={`/company/job-posts/${application.job_postings.id}`}
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    {application.job_postings.title}
                  </Link>
                </span>
              )
            }
            actions={
              <>
                {stages && stages.length > 0 && (
                  <StagePicker
                    applicationId={application.id}
                    stages={stages}
                    currentStageId={application.stage_id}
                    templates={templates ?? []}
                    hasOpenInterview={isOpenInterview(screeningInterview?.status)}
                    canMove={can(company, "pipeline.move", jobId)}
                  />
                )}
                {interview.canManage && jobId && (
                  <ScreeningInterviewActions
                    applicationId={application.id}
                    jobPostId={jobId}
                    candidateName={application.user_info?.full_name || "this applicant"}
                    interview={
                      screeningInterview && {
                        id: screeningInterview.id,
                        status: screeningInterview.status,
                        attemptsUsed: screeningInterview.attemptsUsed,
                        maxAttempts: screeningInterview.maxAttempts,
                        attemptGranted: screeningInterview.attemptGranted,
                        deadlineExtensions: screeningInterview.deadlineExtensions,
                        hasReport: screeningInterview.report !== null,
                      }
                    }
                    invite={{
                      durationMinutes: interview.config?.duration_minutes ?? DEFAULT_DURATION_MINUTES,
                      enabled: !!interview.config?.enabled,
                    }}
                    stageClosed={stageKind === "rejected" || stageKind === "hired"}
                  />
                )}
              </>
            }
          />
        }
      >
        {children}
      </EntityLayout>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
