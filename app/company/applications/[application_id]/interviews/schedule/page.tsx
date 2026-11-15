import { notFound, redirect, unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import InterviewScheduler from "@/components/interviews/scheduler/InterviewScheduler";
import { RecordInterviewForm } from "@/components/interviews/section/RecordInterviewForm";
import { applicationPath, loadApplicationFrame } from "@/helpers/applications/application-page";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { can } from "@/helpers/companies/permissions";
import { loadInterviewPlan } from "@/helpers/interviews/plan";
import { SCHEDULE_PARAM, schedulePath, withItemFirst } from "@/helpers/interviews/schedule-prompt";
import { loadInterviewsCalendar, loadLinkTemplates } from "@/helpers/interviews/scheduler-calendar";

export const metadata: Metadata = {
  title: "Schedule interview",
};

/**
 * Scheduling an interview with people, on its own page under the Interviews
 * section (`scheduling.manage` on the job). With Google Calendar on, it's the
 * scheduler (IVT-045, IVT-065): Book, Send link or Record manually. With it
 * off, it's the record form (IVT-020). `?item=<plan item>` from the stage-move
 * prompt (D8, IVT-072) starts on that interview. A merged application or one
 * in a Rejected or Hired stage goes back to the section, which says why.
 */
export default async function ScheduleInterviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ application_id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const { application_id } = await params;
    const asked = (await searchParams)[SCHEDULE_PARAM];
    const frame = await loadApplicationFrame(application_id);
    if (!frame?.jobId) notFound();
    const { supabase, user, company, application, jobId, mergedInto } = frame;
    if (!can(company, "scheduling.manage", jobId)) notFound();

    const backHref = `${applicationPath(application_id)}/interviews`;
    const [plan, membersRes, stagesRes, openRes] = await Promise.all([
      loadInterviewPlan(supabase, jobId),
      supabase.rpc("list_interviewer_options"),
      supabase.from("pipeline_stages").select("id, name, kind").eq("company_id", company.id),
      // The plan interviews this application already has open: create_scheduled_interview refuses them.
      supabase
        .from("scheduled_interviews")
        .select("plan_item_id")
        .eq("application_id", application_id)
        .in("status", ["awaiting_candidate", "scheduled"])
        .not("plan_item_id", "is", null),
    ]);
    const openItems = new Set((openRes.data ?? []).map((i) => i.plan_item_id));
    const stages = new Map((stagesRes.data ?? []).map((s) => [s.id, s]));
    const stageKind = application.stage_id ? stages.get(application.stage_id)?.kind : undefined;
    if (mergedInto || stageKind === "rejected" || stageKind === "hired") redirect(backHref);

    const members = (membersRes.data ?? []).map((m) => ({ userId: m.user_id, name: m.name ?? "Teammate" }));
    const planned = plan.map((p) => ({
      id: p.id,
      name: p.name,
      stageName: stages.get(p.stage_id)?.name ?? "",
      durationMinutes: p.duration_minutes,
      defaultInterviewerIds: p.default_interviewer_ids,
      scheduled: openItems.has(p.id),
    }));
    const itemId = typeof asked === "string" ? asked : null;
    const { items: planItems, found } = withItemFirst(planned, itemId);
    const [calendar, templates] = calendarEnabled()
      ? await Promise.all([
          loadInterviewsCalendar(supabase, {
            jobId,
            applicationId: application_id,
            userId: user.id,
            userIds: members.map((m) => m.userId),
          }),
          loadLinkTemplates(supabase, company.id),
        ])
      : [null, []];

    return (
      <div className="mb-20 flex flex-col gap-6">
        <SectionHeader
          title={calendar ? "Schedule interview" : "Record interview"}
          description={
            calendar
              ? "Book a time on your Google Calendar with a Meet link, send the candidate a link to pick one, or record one arranged elsewhere."
              : "For an interview arranged outside GetHired. Nobody is emailed. Interviewers get the kit and their scorecard."
          }
          backHref={backHref}
          backLabel="Interviews"
        />
        {calendar ? (
          <InterviewScheduler
            applicationId={application_id}
            jobPostId={jobId}
            members={members}
            planItems={planItems}
            // Connecting a calendar comes back here, on the same interview.
            returnTo={schedulePath(application_id, found ? itemId : null)}
            backHref={backHref}
            templates={templates}
            agentHandoff={can(company, "agent.use")}
            calendar={{
              own: calendar.own,
              members: calendar.statuses,
              candidateInvitable: calendar.candidateInvitable,
            }}
          />
        ) : (
          <RecordInterviewForm
            applicationId={application_id}
            members={members}
            planItems={planItems}
            backHref={backHref}
          />
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
