import { notFound, unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import Error from "@/components/Error";
import { AskAgentAboutApplicationInterviews } from "@/components/agent/recruiter/AskAgentAboutInterviews";
import SectionHeader from "@/components/SectionHeader";
import ApplicationInterviews from "@/components/interviews/section/ApplicationInterviews";
import FeedbackSummaryCard from "@/components/interviews/section/FeedbackSummaryCard";
import { Button } from "@/components/ui/button";
import { applicationPath, loadApplicationFrame } from "@/helpers/applications/application-page";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { can } from "@/helpers/companies/permissions";
import { loadFeedbackSummary } from "@/helpers/interviews/feedback-summary";
import { listApplicationInterviews } from "@/helpers/interviews/interviews";
import { schedulePath } from "@/helpers/interviews/schedule-prompt";
import { loadInterviewsCalendar, loadLinkTemplates } from "@/helpers/interviews/scheduler-calendar";
import { stagesForJob } from "@/helpers/pipeline/stages";

export const metadata: Metadata = {
  title: "Interviews",
};

/**
 * An application's Interviews section (IVT-020): the interviews with people,
 * for `scheduling.view` on the job. Recording, rescheduling and the rest need
 * `scheduling.manage`, an open stage and an application that wasn't merged.
 * The button goes to the schedule page (`schedule/`): the scheduler with
 * Google Calendar on (IVT-045), the record form with it off. With the
 * calendar on, booked interviews show their organizer's calendar problems
 * (IVT-048), and resending a link (IVT-065) uses the company's interview
 * invite templates. With `scorecards.view_all`, the AI feedback summary sits
 * above the interviews (IVT-081). With `agent.use`, the agent box sits under
 * the header (IVT-086).
 */
export default async function ApplicationInterviewsPage({
  params,
}: {
  params: Promise<{ application_id: string }>;
}) {
  try {
    const { application_id } = await params;
    const frame = await loadApplicationFrame(application_id);
    if (!frame?.jobId) notFound();
    const { supabase, user, company, application, person, jobId, mergedInto } = frame;
    if (!can(company, "scheduling.view", jobId)) notFound();

    const [groups, membersRes, jobStages, feedbackSummary] = await Promise.all([
      listApplicationInterviews(supabase, application_id),
      supabase.rpc("list_interviewer_options"),
      // The job's own pipeline (JP-REQ-004), archived stages too.
      stagesForJob(company.id, jobId, true),
      // Extra: a failed read leaves the summary out rather than the section.
      can(company, "scorecards.view_all", jobId)
        ? loadFeedbackSummary(supabase, application_id).catch(() => null)
        : Promise.resolve(null),
    ]);
    const stages = new Map(jobStages.map((s) => [s.id, s]));
    const stageKind = application.stage_id ? stages.get(application.stage_id)?.kind : undefined;
    const closed = stageKind === "rejected" || stageKind === "hired";
    const canManage = can(company, "scheduling.manage", jobId) && !mergedInto && !closed;
    const agent = !mergedInto && can(company, "agent.use");
    const members = (membersRes.data ?? []).map((m) => ({ userId: m.user_id, name: m.name ?? "Teammate" }));
    const returnTo = `${applicationPath(application_id)}/interviews`;
    const organizers = groups.flatMap((g) => g.interviews.map((i) => i.organizerUserId)).filter((id): id is string => !!id);
    // panel_calendar_status needs scheduling.manage, so readers without it see no banners.
    const [calendar, templates] =
      calendarEnabled() && can(company, "scheduling.manage", jobId)
        ? await Promise.all([
            loadInterviewsCalendar(supabase, {
              jobId,
              applicationId: application_id,
              userId: user.id,
              userIds: [...members.map((m) => m.userId), ...organizers],
            }),
            loadLinkTemplates(supabase, company.id),
          ])
        : [null, []];

    const description = mergedInto
      ? "This application was merged. Its interviews moved with it."
      : closed && can(company, "scheduling.manage", jobId)
        ? "The application is in a Rejected or Hired stage, so no new interviews can be recorded."
        : "Interviews with your team, their scorecards and the panel's feedback. Notes are in the Notes section.";

    return (
      <div className="mb-20 flex flex-col gap-6">
        <SectionHeader
          title="Interviews"
          description={description}
          actions={
            canManage && (
              <Button asChild variant="brand">
                <Link href={schedulePath(application_id)}>{calendar ? "Schedule interview" : "Record interview"}</Link>
              </Button>
            )
          }
        />
        {agent && (
          <AskAgentAboutApplicationInterviews
            application={{
              id: application_id,
              candidateName: person.name,
              jobTitle: application.job_postings?.title ?? null,
            }}
            canSummarize={can(company, "scorecards.view_all", jobId)}
            canSchedule={canManage}
          />
        )}
        {feedbackSummary && feedbackSummary.submitted > 0 && (
          <FeedbackSummaryCard
            key={`${feedbackSummary.createdAt ?? "none"}:${feedbackSummary.submitted}:${feedbackSummary.stale}`}
            applicationId={application_id}
            initial={feedbackSummary}
          />
        )}
        <ApplicationInterviews
          groups={groups}
          members={members}
          canManage={canManage}
          currentUserId={user.id}
          calendar={calendar ? { statuses: calendar.statuses, returnTo, templates } : undefined}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
