import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { FileText, FileUser, History, Mic, Sparkles, StickyNote, User } from "lucide-react";
import Error from "@/components/Error";
import ImportedBadge from "@/components/candidates/ImportedBadge";
import MergedNotice from "@/components/candidates/MergedNotice";
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
 * The candidate's name names the answers tab, and the sections' titles get it
 * as a suffix ("Notes · <name>"). The frame load is request-cached, so this
 * shares the layout's query.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ application_id: string }>;
}): Promise<Metadata> {
  const { application_id } = await params;
  const frame = await loadApplicationFrame(application_id).catch(() => null);
  if (!frame) return { title: "Application" };
  const name = frame.person.name;
  return { title: { default: name, template: `%s · ${name} | GetHired` } };
}

/**
 * An application's frame: the sections sidebar (answers, candidate, resume,
 * fit screening, AI interview, notes, activity) and the header with the stage
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
    const { supabase, company, application, person, jobId, mergedInto, mergedFrom } = frame;

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
    const candidateName = person.name;

    const base = applicationPath(application.id);
    const items: EntityNavItem[] = [
      { href: base, label: "Answers", icon: <FileText />, exact: true },
      { href: `${base}/candidate`, label: "Candidate", icon: <User /> },
      { href: `${base}/resume`, label: "Resume", icon: <FileUser /> },
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
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span className="[overflow-wrap:anywhere]">{candidateName}</span>
                <ImportedBadge person={person} />
              </span>
            }
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
                {/* BI-REQ-042: a merged import is read-only. */}
                {!mergedInto && stages && stages.length > 0 && (
                  <StagePicker
                    applicationId={application.id}
                    stages={stages}
                    currentStageId={application.stage_id}
                    templates={templates ?? []}
                    hasOpenInterview={isOpenInterview(screeningInterview?.status)}
                    canMove={can(company, "pipeline.move", jobId)}
                  />
                )}
                {!mergedInto && interview.canManage && jobId && (
                  <ScreeningInterviewActions
                    applicationId={application.id}
                    jobPostId={jobId}
                    candidateName={candidateName}
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
        <div className="flex flex-col gap-6">
          <MergedNotice mergedInto={mergedInto} mergedFrom={mergedFrom} />
          {children}
        </div>
      </EntityLayout>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
