import { tool } from "ai";
import { z } from "zod";
import { wrapInSandbox } from "@/helpers/ai/security";
import { calendarProvider } from "@/helpers/calendar/active-provider";
import { connectCalendarHref } from "@/helpers/calendar/config";
import { calendarEnabled } from "@/helpers/calendar/connect";
import {
  findSlotsToolSchema,
  interviewIdToolSchema,
  planItemsOf,
  rescheduleToolSchema,
  savePlanToolSchema,
  scheduleToolSchema,
  sendLinkToolSchema,
} from "@/helpers/interviews/agent-scheduling-schema";
import { FEEDBACK_SUMMARY_MIN, PANEL_MAX } from "@/helpers/interviews/config";
import { feedbackSummaryMessage, generateFeedbackSummary, loadFeedbackSummary } from "@/helpers/interviews/feedback-summary";
import { cancelInterview, listApplicationInterviews, recordInterview, updateInterview } from "@/helpers/interviews/interviews";
import { listJobInterviews } from "@/helpers/interviews/job-interviews";
import { loadInterviewPlan, saveInterviewPlan } from "@/helpers/interviews/plan";
import { draftPlanForJob } from "@/helpers/interviews/plan-draft";
import { remindInterviewers } from "@/helpers/interviews/remind-interviewers";
import { loadLinkTemplates } from "@/helpers/interviews/scheduler-calendar";
import {
  bookInterview,
  findInterviewSlots,
  syncCancelledInterview,
  syncUpdatedInterview,
} from "@/helpers/interviews/scheduling";
import { sendSchedulingLink } from "@/helpers/interviews/scheduling-links";
import { actorName } from "@/helpers/pipeline/move";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  applicationUrl,
  jobPostUrl,
  planLimitError,
  uuidInput,
  withToolErrors,
  type RecruiterToolContext,
} from "./shared";

// Human interviews (IVT-082, IV-REQ-052): plans, scheduling and feedback.
// Every tool runs over the same helpers as the pages, whose RPCs check the
// permission for the job again. There's no tool that writes a scorecard
// (D10). Scorecard text and candidate names are sandboxed (RA-SEC-003), and
// blind review comes from the RPCs: a blind reader gets statuses, never
// content. A scheduling link's URL never reaches the model: only its hash is
// stored, and the candidate gets it by email.

const JOB_NOT_FOUND = { error: "Job post not found." } as const;
/** Slots per findInterviewSlots answer: the earliest ones. */
export const SLOTS_SHOWN = 40;

const CALENDAR_OFF = {
  error:
    "Google Calendar scheduling isn't turned on for this company yet. Use scheduleInterview with method record for an interview arranged outside GetHired.",
} as const;

const interviewsUrl = (applicationId: string) => `${applicationUrl(applicationId)}/interviews`;
const planUrl = (jobPostId: string) => `${jobPostUrl(jobPostId)}/interview-plan`;

async function companyJob(ctx: RecruiterToolContext, jobPostId: string) {
  const { data, error } = await ctx.supabase
    .from("job_postings")
    .select("id, title")
    .eq("id", jobPostId)
    .eq("company_id", ctx.company.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the job post: ${error.message}`);
  return data;
}

/** The company's members who can be on a panel, as `{ id, name }`. */
async function interviewers(ctx: RecruiterToolContext) {
  const { data, error } = await ctx.supabase.rpc("list_interviewer_options");
  if (error) throw new Error(`Failed to load the team: ${error.message}`);
  return (data ?? []).map((m) => ({ id: m.user_id, name: m.name }));
}

/** Stages a plan interview can belong to (IV-REQ-002). */
async function openStages(ctx: RecruiterToolContext) {
  const { data, error } = await ctx.supabase
    .from("pipeline_stages")
    .select("id, name, kind, archived")
    .eq("company_id", ctx.company.id)
    .order("position", { ascending: true });
  if (error) throw new Error(`Failed to load the stages: ${error.message}`);
  return (data ?? []).filter((s) => !s.archived && s.kind !== "rejected" && s.kind !== "hired");
}

/** The session's deps for the Google Calendar helpers. */
function calendarDeps(ctx: RecruiterToolContext) {
  return { supabase: ctx.supabase, admin: createServiceRoleClient(), provider: calendarProvider(), userId: ctx.user.id };
}

async function applicationJob(ctx: RecruiterToolContext, applicationId: string): Promise<string | null> {
  const { data, error } = await ctx.supabase.rpc("application_job_id", { p_application_id: applicationId });
  if (error) throw new Error(`application_job_id failed: ${error.message}`);
  return (data as string | null) ?? null;
}

/** Where the member's times are shown: their own zone, else the company's. */
async function memberTimeZone(ctx: RecruiterToolContext): Promise<string> {
  const [{ data: own }, { data: company }] = await Promise.all([
    ctx.supabase.from("member_availability").select("time_zone").eq("user_id", ctx.user.id).maybeSingle(),
    ctx.supabase.from("company_info").select("time_zone").eq("id", ctx.company.id).maybeSingle(),
  ]);
  return own?.time_zone || company?.time_zone || "UTC";
}

/** A Google refusal that a connection fixes gets the link to connect. */
const withConnectHint = (reason: string, error: string, applicationId: string) =>
  reason === "not_connected" || reason === "organizer_reconnect"
    ? { error, connectUrl: connectCalendarHref(interviewsUrl(applicationId)) }
    : { error };

export function createSchedulingTools(ctx: RecruiterToolContext) {
  return {
    getInterviewPlan: tool({
      description:
        "Read a job's interview plan: its interviews (by pipeline stage, with length, interviewer instructions, default interviewers, and competencies with suggested questions), the open stages a plan interview can use, and the team members who can interview. Plan interview, stage and interviewer ids from here are what the scheduling tools take.",
      inputSchema: z.object({ jobPostId: uuidInput("job post") }),
      execute: ({ jobPostId }) =>
        withToolErrors(ctx, "getInterviewPlan", async () => {
          const job = await companyJob(ctx, jobPostId);
          if (!job) return JOB_NOT_FOUND;
          const [plan, stages, team] = await Promise.all([
            loadInterviewPlan(ctx.supabase, jobPostId),
            openStages(ctx),
            interviewers(ctx),
          ]);
          const stageName = new Map(stages.map((s) => [s.id, s.name]));
          const memberName = new Map(team.map((m) => [m.id, m.name]));
          return {
            jobPostId,
            jobTitle: job.title,
            interviews: plan.map((item) => ({
              id: item.id,
              stageId: item.stage_id,
              stage: stageName.get(item.stage_id) ?? null,
              name: item.name,
              durationMinutes: item.duration_minutes,
              instructions: item.instructions,
              defaultInterviewers: item.default_interviewer_ids.map((id) => ({ id, name: memberName.get(id) ?? null })),
              competencies: item.competencies.map((c) => ({
                id: c.id,
                name: c.name,
                description: c.description,
                questions: c.questions,
              })),
            })),
            stages: stages.map((s) => ({ id: s.id, name: s.name })),
            interviewers: team,
            ...(plan.length === 0
              ? { message: "This job has no interview plan yet. draftInterviewPlan drafts one from the job post." }
              : {}),
            url: planUrl(jobPostId),
          };
        }),
    }),

    draftInterviewPlan: tool({
      description:
        "Draft a job's interview plan from its job post with AI: interviews mapped onto the company's stages, each with competencies and suggested questions. Uses 1 agent message from the plan's allowance. Nothing is saved: show the user the draft and save it with saveInterviewPlan if they agree. Saving replaces the whole plan, so keep the current plan's interviews (with their ids) in that call if they should stay.",
      inputSchema: z.object({ jobPostId: uuidInput("job post") }),
      execute: ({ jobPostId }) =>
        withToolErrors(ctx, "draftInterviewPlan", async () => {
          const result = await draftPlanForJob({ supabase: ctx.supabase, company: ctx.company, user: ctx.user }, jobPostId);
          if ("entitlement" in result) {
            return planLimitError({ ...result.entitlement.payload, message: result.entitlement.message });
          }
          if (!result.ok) return { error: result.error };
          const stageName = new Map((result.stages ?? []).map((s) => [s.id, s.name]));
          return {
            jobPostId,
            saved: false,
            interviews: result.items.map((item) => ({
              stageId: item.stage_id,
              stage: stageName.get(item.stage_id) ?? null,
              name: item.name,
              durationMinutes: item.duration_minutes,
              instructions: item.instructions,
              competencies: item.competencies,
            })),
            notes: result.notes,
            url: planUrl(jobPostId),
          };
        }),
    }),

    saveInterviewPlan: tool({
      description:
        "Save a job's whole interview plan, in order: each interview's stage, name, length, interviewer instructions, default interviewers and 1–10 competencies (name, description, suggested questions). It replaces the current plan: an interview or competency left out is removed. To keep or edit existing ones, send them with their ids from getInterviewPlan. Interviews already scheduled keep their own copy. Names, competencies and questions must be job-related, never about protected characteristics.",
      inputSchema: savePlanToolSchema,
      execute: (input) =>
        withToolErrors(ctx, "saveInterviewPlan", async () => {
          const job = await companyJob(ctx, input.jobPostId);
          if (!job) return JOB_NOT_FOUND;
          const result = await saveInterviewPlan(ctx.supabase, input.jobPostId, planItemsOf(input));
          if (!result.ok) return { error: result.error, ...(result.field ? { field: result.field } : {}) };
          const plan = await loadInterviewPlan(ctx.supabase, input.jobPostId);
          return {
            jobPostId: input.jobPostId,
            saved: true,
            interviews: plan.map((item) => ({ id: item.id, name: item.name })),
            url: planUrl(input.jobPostId),
          };
        }),
    }),

    listScheduledInterviews: tool({
      description:
        "List interviews with people (not the AI screening interview). With applicationId: every interview on the application with its stage, status, time, panel (each interviewer's scorecard state) and the submitted scorecards the user may read (blind review hides teammates' scorecards until the user submits their own). With jobPostId: the job's open interviews (waiting on the candidate, booked, or finished in the last 7 days) and who still owes feedback. Give one of the two.",
      inputSchema: z
        .object({
          applicationId: uuidInput("application").optional(),
          jobPostId: uuidInput("job post").optional(),
        })
        .strict()
        .refine((v) => Boolean(v.applicationId) !== Boolean(v.jobPostId), {
          message: "Give either applicationId or jobPostId.",
        }),
      execute: ({ applicationId, jobPostId }) =>
        withToolErrors(ctx, "listScheduledInterviews", async () => {
          if (jobPostId) {
            const job = await companyJob(ctx, jobPostId);
            if (!job) return JOB_NOT_FOUND;
            const list = await listJobInterviews(ctx.supabase, jobPostId);
            return {
              jobPostId,
              jobTitle: job.title,
              count: list.length,
              // Candidate names are candidate-written (RA-SEC-003).
              interviews: wrapInSandbox(
                "interview_list",
                JSON.stringify(
                  list.map((i) => ({
                    id: i.id,
                    applicationId: i.applicationId,
                    candidate: i.candidateName,
                    name: i.name,
                    status: i.status,
                    startsAt: i.startsAt,
                    durationMinutes: i.durationMinutes,
                    panel: i.panel.map((p) => ({ id: p.userId, name: p.name, scorecard: p.scorecardStatus })),
                    feedbackOwedBy: i.feedbackOwedBy,
                    url: interviewsUrl(i.applicationId),
                  })),
                ),
              ),
            };
          }

          const id = applicationId as string;
          const groups = await listApplicationInterviews(ctx.supabase, id);
          const all = groups.flatMap((g) => g.interviews.map((i) => ({ ...i, stage: g.stageName })));
          const hidden = all.reduce((sum, i) => sum + i.hidden, 0);
          const readable = all.flatMap((i) =>
            i.panel
              .filter((p) => p.visible && p.scorecardStatus === "submitted")
              .map((p) => ({
                interview: i.name,
                author: p.name,
                overall: p.overall,
                overallNote: p.overallNote,
                competencies: i.competencies.map((c) => ({
                  name: c.name,
                  rating: p.ratings?.[c.id]?.rating ?? null,
                  note: p.ratings?.[c.id]?.note ?? "",
                })),
              })),
          );
          return {
            applicationId: id,
            interviews: all.map((i) => ({
              id: i.id,
              name: i.name,
              stage: i.stage,
              status: i.status,
              startsAt: i.startsAt,
              endsAt: i.endsAt,
              durationMinutes: i.durationMinutes,
              onGoogleCalendar: i.onCalendar,
              meetingUrl: i.meetingUrl,
              panel: i.panel.map((p) => ({ id: p.userId, name: p.name, response: p.response, scorecard: p.scorecardStatus })),
              feedback: { submitted: i.submitted, total: i.panel.length, hidden: i.hidden },
              ratingCounts: i.summary.map((s) => ({ competency: s.name, ...s.counts })),
            })),
            // Colleagues' notes can quote the candidate (RA-SEC-003).
            scorecards: readable.length > 0 ? wrapInSandbox("panel_scorecards", JSON.stringify(readable)) : null,
            ...(hidden > 0
              ? { message: `${hidden} submitted scorecard${hidden === 1 ? " is" : "s are"} hidden until the user submits their own (blind review).` }
              : {}),
            ...(all.length === 0 ? { message: "No interviews on this application yet." } : {}),
            url: interviewsUrl(id),
          };
        }),
    }),

    findInterviewSlots: tool({
      description: `Find open times for an interview on an application over the next 14 days, from the panel's Google Calendars (1 to ${PANEL_MAX} interviewers): at least 24 hours ahead, on a 30-minute grid, inside everyone's working hours, with a 10-minute buffer. An interviewer whose calendar can't be read shows as availability unknown and isn't checked. Returns the earliest ${SLOTS_SHOWN} start times and the user's time zone: show times to the user in that zone.`,
      inputSchema: findSlotsToolSchema,
      execute: (input) =>
        withToolErrors(ctx, "findInterviewSlots", async () => {
          if (!calendarEnabled()) return CALENDAR_OFF;
          const jobPostId = await applicationJob(ctx, input.applicationId);
          if (!jobPostId) return { error: "Application not found." };

          let durationMinutes = input.durationMinutes;
          if (input.planItemId) {
            const { data: item } = await ctx.supabase
              .from("job_interview_plan_items")
              .select("duration_minutes")
              .eq("id", input.planItemId)
              .eq("job_post_id", jobPostId)
              .maybeSingle();
            if (!item) return { error: "That interview isn't in this job's plan." };
            durationMinutes = item.duration_minutes;
          }

          const result = await findInterviewSlots(calendarDeps(ctx), {
            jobPostId,
            panel: input.interviewerIds,
            durationMinutes: durationMinutes as number,
          });
          if (!result.ok) return withConnectHint(result.reason, result.error, input.applicationId);
          const [timeZone, team] = await Promise.all([memberTimeZone(ctx), interviewers(ctx)]);
          const memberName = new Map(team.map((m) => [m.id, m.name]));
          const unknown = result.members.filter((m) => !m.availabilityKnown);
          return {
            applicationId: input.applicationId,
            durationMinutes,
            timeZone,
            slots: result.slots.slice(0, SLOTS_SHOWN).map((s) => s.start),
            totalSlots: result.slots.length,
            panel: result.members.map((m) => ({
              id: m.userId,
              name: memberName.get(m.userId) ?? null,
              calendar: m.status,
              availabilityKnown: m.availabilityKnown,
            })),
            ...(unknown.length > 0
              ? {
                  message: `Availability unknown for ${unknown.map((m) => memberName.get(m.userId) ?? "an interviewer").join(", ")}: their calendar isn't connected or couldn't be read, so these times don't check it.`,
                }
              : {}),
          };
        }),
    }),

    scheduleInterview: tool({
      description:
        "Schedule an interview on an application at a time the user chose: a plan interview (planItemId) or an ad-hoc one (name and durationMinutes), with 1 to 6 interviewers. method book puts it on the user's Google Calendar with a Meet link, and Google emails the interviewers and the candidate (a candidate who can't be emailed gets no invite). method record notes an interview arranged outside GetHired and emails nobody. Prefer a time from findInterviewSlots when booking.",
      inputSchema: scheduleToolSchema,
      execute: (input) =>
        withToolErrors(ctx, "scheduleInterview", async () => {
          const fields = {
            applicationId: input.applicationId,
            planItemId: input.planItemId ?? null,
            name: input.planItemId ? null : (input.name ?? null),
            durationMinutes: input.planItemId ? null : (input.durationMinutes ?? null),
            panel: input.interviewerIds,
            startsAt: input.startsAt,
          };
          if (input.method === "record") {
            const result = await recordInterview(ctx.supabase, { ...fields, meetingUrl: input.meetingUrl ?? null });
            if (!result.ok) return { error: result.error };
            return {
              scheduled: true,
              method: "record",
              interviewId: result.id ?? null,
              status: result.status,
              emailed: false,
              url: interviewsUrl(result.applicationId),
            };
          }
          if (!calendarEnabled()) return CALENDAR_OFF;
          const result = await bookInterview(calendarDeps(ctx), fields);
          if (!result.ok) return withConnectHint(result.reason, result.error, input.applicationId);
          return {
            scheduled: true,
            method: "book",
            interviewId: result.id,
            candidateInvited: result.candidateInvited,
            meetingUrl: result.meetingUrl,
            ...(result.candidateInvited
              ? {}
              : { message: "The candidate won't get a calendar invite: they can't be emailed. The user should pass on the time and link." }),
            url: interviewsUrl(result.applicationId),
          };
        }),
    }),

    sendSchedulingLink: tool({
      description:
        "Email the candidate a link to pick a time for an interview themselves (valid 7 days), using one of the company's email templates (the default interview invite unless templateId is given). Every interviewer, and the user, must have connected Google Calendar. The candidate can reschedule or cancel from the link. The link itself is never shown here.",
      inputSchema: sendLinkToolSchema,
      execute: (input) =>
        withToolErrors(ctx, "sendSchedulingLink", async () => {
          if (!calendarEnabled()) return CALENDAR_OFF;
          const templates = await loadLinkTemplates(ctx.supabase, ctx.company.id);
          const template = input.templateId ? templates.find((t) => t.id === input.templateId) : templates[0];
          if (!template) {
            return {
              error: input.templateId
                ? "That email template can't send a scheduling link. Pick an interview invite template."
                : "There's no interview invite email template yet. Create one with createEmailTemplate (purpose interview_invite) that includes {{scheduling_link}}.",
            };
          }
          const result = await sendSchedulingLink(
            { supabase: ctx.supabase, admin: createServiceRoleClient(), user: ctx.user, company: ctx.company },
            {
              applicationId: input.applicationId,
              planItemId: input.planItemId ?? null,
              name: input.planItemId ? null : (input.name ?? null),
              durationMinutes: input.planItemId ? null : (input.durationMinutes ?? null),
              panel: input.interviewerIds,
              templateId: template.id,
            },
          );
          if (!result.ok) return withConnectHint(result.reason, result.error, input.applicationId);
          // The link stays out of the conversation: only its hash is stored.
          return {
            sent: true,
            interviewId: result.id,
            template: template.name,
            expiresAt: result.expiresAt,
            url: interviewsUrl(result.applicationId),
          };
        }),
    }),

    rescheduleInterview: tool({
      description:
        "Change a scheduled interview: move it to a new time, replace its interviewers (send the whole new panel), or change its meeting link. A booked interview's Google Calendar event follows and Google emails the attendees. A removed interviewer's draft scorecard is deleted; submitted ones stay.",
      inputSchema: rescheduleToolSchema,
      execute: (input) =>
        withToolErrors(ctx, "rescheduleInterview", async () => {
          const result = await updateInterview(ctx.supabase, {
            interviewId: input.interviewId,
            ...(input.startsAt ? { startsAt: input.startsAt } : {}),
            ...(input.interviewerIds ? { panel: input.interviewerIds } : {}),
            ...(input.meetingUrl !== undefined ? { meetingUrl: input.meetingUrl } : {}),
          });
          if (!result.ok) return { error: result.error };
          const followUp = calendarEnabled()
            ? await syncUpdatedInterview(calendarDeps(ctx), input.interviewId, {
                time: input.startsAt !== undefined,
                panel: input.interviewerIds !== undefined,
              })
            : {};
          return {
            updated: true,
            interviewId: input.interviewId,
            status: result.status,
            ...(followUp.calendarWarning ? { calendarWarning: followUp.calendarWarning } : {}),
            url: interviewsUrl(result.applicationId),
          };
        }),
    }),

    cancelInterview: tool({
      description:
        "Cancel an interview that's waiting on the candidate or scheduled. A booked interview's Google Calendar event is removed and Google emails the attendees; a scheduling link stops working. The interviewers lose the interview kit.",
      inputSchema: interviewIdToolSchema,
      execute: ({ interviewId }) =>
        withToolErrors(ctx, "cancelInterview", async () => {
          const result = await cancelInterview(ctx.supabase, interviewId);
          if (!result.ok) return { error: result.error };
          const followUp = calendarEnabled() ? await syncCancelledInterview(calendarDeps(ctx), interviewId) : {};
          return {
            cancelled: true,
            interviewId,
            ...(followUp.calendarWarning ? { calendarWarning: followUp.calendarWarning } : {}),
            url: interviewsUrl(result.applicationId),
          };
        }),
    }),

    remindInterviewers: tool({
      description:
        "Email the interviewers who haven't submitted their scorecard for an interview a reminder with a link to it. Only once the interview has started, and at most once per interviewer per interview every 24 hours. Only team members are emailed, never the candidate.",
      inputSchema: interviewIdToolSchema,
      execute: ({ interviewId }) =>
        withToolErrors(ctx, "remindInterviewers", async () => {
          const result = await remindInterviewers(
            {
              supabase: ctx.supabase,
              admin: createServiceRoleClient(),
              senderName: actorName(ctx.user, ctx.company) ?? "A teammate",
            },
            interviewId,
          );
          if (!result.ok) return { error: result.error };
          return {
            interviewId,
            reminded: result.reminded.map((m) => m.name),
            notReminded: result.skipped.map((s) => ({
              name: s.name,
              reason:
                s.reason === "submitted"
                  ? "already submitted"
                  : s.reason === "recent"
                    ? "reminded in the last 24 hours"
                    : "the email failed",
            })),
            url: interviewsUrl(result.applicationId),
          };
        }),
    }),

    summarizeFeedback: tool({
      description: `Summarize the submitted interview scorecards on an application: where the interviewers agree, where they disagree per competency, and open concerns, with verbatim quotes. Needs at least ${FEEDBACK_SUMMARY_MIN} submitted scorecards. Returns the saved summary when it's still current (free); otherwise writes a new one, which uses 1 agent message from the plan's allowance (regenerate forces a new one). It never recommends hiring or rejecting: present it as the panel's feedback, not a decision.`,
      inputSchema: z
        .object({
          applicationId: uuidInput("application"),
          regenerate: z.boolean().optional().describe("Write a new summary even if the saved one is current."),
        })
        .strict(),
      execute: ({ applicationId, regenerate }) =>
        withToolErrors(ctx, "summarizeFeedback", async () => {
          const current = await loadFeedbackSummary(ctx.supabase, applicationId);
          if (!current) return { error: feedbackSummaryMessage("not_found") };
          let view = current;
          let charged = false;
          if (!current.summary || current.stale || regenerate) {
            if (current.submitted < current.min) return { error: feedbackSummaryMessage("too_few"), submitted: current.submitted };
            const result = await generateFeedbackSummary(ctx.supabase, {
              companyId: ctx.company.id,
              userId: ctx.user.id,
              applicationId,
            });
            if (!result.ok) {
              return "entitlement" in result
                ? planLimitError({ ...result.entitlement.payload, message: result.entitlement.message })
                : { error: result.error };
            }
            view = result.view;
            charged = true;
          }
          return {
            applicationId,
            submittedScorecards: view.submitted,
            createdAt: view.createdAt,
            charged,
            // Built from colleagues' notes, which can quote the candidate (RA-SEC-003).
            summary: wrapInSandbox("feedback_summary", JSON.stringify(view.summary)),
            url: interviewsUrl(applicationId),
          };
        }),
    }),
  };
}
