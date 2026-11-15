import "server-only";
import type { z } from "zod";
import type { CompanySessionContext } from "@/helpers/companies/company-session";
import { companyAllows } from "@/helpers/companies/require-company";
import { LINK_VALID_DAYS } from "@/helpers/calendar/config";
import {
  interviewIdToolSchema,
  rescheduleToolSchema,
  savePlanToolSchema,
  scheduleToolSchema,
  sendLinkToolSchema,
  type SchedulingPreview,
  type SchedulingPreviewRow,
  type SchedulingPreviewTool,
} from "./agent-scheduling-schema";
import { interviewMessage } from "./copy";
import { previewReminders } from "./remind-interviewers";
import { loadLinkTemplates } from "./scheduler-calendar";

// IVT-082: what a recruiter agent scheduling call would do, for its approval
// card, and for MCP's confirmation (IVT-085). Reads only: nothing is
// written, and the call itself checks everything again. Each preview checks
// its permission, since MCP has no action wrapper. No contact details.

type Session = CompanySessionContext;

const NOT_READABLE = { ok: false, error: "Couldn't read this request." } as const;

const fail = (error: string): SchedulingPreview => ({ ok: false, error });

const personName = (row: {
  user_info?: { full_name?: string | null } | null;
  company_candidates?: { full_name?: string | null } | null;
} | null) => row?.company_candidates?.full_name?.trim() || row?.user_info?.full_name?.trim() || "The candidate";

async function interviewerNames(session: Session): Promise<Map<string, string>> {
  const { data } = await session.supabase.rpc("list_interviewer_options");
  return new Map((data ?? []).map((m) => [m.user_id, m.name]));
}

const namesOf = (ids: string[], names: Map<string, string>) =>
  ids.map((id) => names.get(id) ?? "Someone who isn't on your team").join(", ");

/** The application, its job and the candidate's name, if the member may schedule on it. */
async function applicationContext(session: Session, applicationId: string) {
  const { data } = await session.supabase
    .from("applications")
    .select("id, job_post_id, user_info(full_name), company_candidates(full_name), job_postings(title)")
    .eq("id", applicationId)
    .maybeSingle();
  if (!data?.job_post_id) return { ok: false, error: interviewMessage("not_found") } as const;
  const denied = companyAllows(session.company, { permission: "scheduling.manage", jobId: data.job_post_id });
  if (denied) return { ok: false, error: denied } as const;
  return {
    ok: true,
    jobPostId: data.job_post_id,
    jobTitle: data.job_postings?.title ?? "",
    candidate: personName(data),
  } as const;
}

/** The interview's name and length: the plan's, or the ad-hoc one given. */
async function interviewWhat(
  session: Session,
  jobPostId: string,
  input: { planItemId?: string; name?: string; durationMinutes?: number },
): Promise<{ ok: true; name: string; minutes: number } | { ok: false; error: string }> {
  if (!input.planItemId) return { ok: true, name: input.name ?? "Interview", minutes: input.durationMinutes ?? 0 };
  const { data } = await session.supabase
    .from("job_interview_plan_items")
    .select("name, duration_minutes")
    .eq("id", input.planItemId)
    .eq("job_post_id", jobPostId)
    .maybeSingle();
  if (!data) return { ok: false, error: interviewMessage("invalid_plan_item") };
  return { ok: true, name: data.name, minutes: data.duration_minutes };
}

async function candidateInvitable(session: Session, applicationId: string) {
  const { data } = await session.supabase.rpc("interview_candidate_invitable", { p_application_id: applicationId });
  return data === true;
}

async function previewSchedule(session: Session, input: z.infer<typeof scheduleToolSchema>): Promise<SchedulingPreview> {
  const app = await applicationContext(session, input.applicationId);
  if (!app.ok) return fail(app.error);
  const what = await interviewWhat(session, app.jobPostId, input);
  if (!what.ok) return fail(what.error);
  const names = await interviewerNames(session);
  const rows: SchedulingPreviewRow[] = [
    { label: "Candidate", value: app.candidate },
    { label: "Job", value: app.jobTitle },
    { label: "Interview", value: `${what.name} · ${what.minutes} min` },
    { label: "Interviewers", value: namesOf(input.interviewerIds, names) },
    { label: "When", value: input.startsAt, time: true },
  ];
  if (input.method === "record") {
    if (input.meetingUrl) rows.push({ label: "Meeting link", value: input.meetingUrl });
    return { ok: true, rows, notices: ["Recorded only: no calendar event is created and nobody is emailed."] };
  }
  const invitable = await candidateInvitable(session, input.applicationId);
  return {
    ok: true,
    rows,
    notices: [
      invitable
        ? "Books it on your Google Calendar with a Meet link. Google emails the interviewers and the candidate."
        : "Books it on your Google Calendar with a Meet link. Google emails the interviewers.",
      ...(invitable ? [] : ["This candidate won't get a calendar invite. Pass on the time and link yourself."]),
    ],
  };
}

async function previewSendLink(session: Session, input: z.infer<typeof sendLinkToolSchema>): Promise<SchedulingPreview> {
  const app = await applicationContext(session, input.applicationId);
  if (!app.ok) return fail(app.error);
  const what = await interviewWhat(session, app.jobPostId, input);
  if (!what.ok) return fail(what.error);
  const [names, templates, invitable] = await Promise.all([
    interviewerNames(session),
    loadLinkTemplates(session.supabase, session.company.id),
    candidateInvitable(session, input.applicationId),
  ]);
  const template = input.templateId ? templates.find((t) => t.id === input.templateId) : templates[0];
  if (!template) {
    return fail(
      input.templateId
        ? "That email template can't send a scheduling link."
        : "There's no interview invite email template yet. Add one in Settings → Email templates.",
    );
  }
  return {
    ok: true,
    rows: [
      { label: "Candidate", value: app.candidate },
      { label: "Job", value: app.jobTitle },
      { label: "Interview", value: `${what.name} · ${what.minutes} min` },
      { label: "Interviewers", value: namesOf(input.interviewerIds, names) },
      { label: "Email", value: template.name },
    ],
    notices: [
      `The candidate gets an email with a link to pick a time. The link works for ${LINK_VALID_DAYS} days.`,
    ],
    ...(invitable ? {} : { warning: "This candidate can't be emailed, so the link can't be sent." }),
  };
}

/** The interview, if the member may change it. */
async function interviewContext(session: Session, interviewId: string) {
  const { data } = await session.supabase
    .from("scheduled_interviews")
    .select(
      "id, job_post_id, application_id, name, status, starts_at, provider_event_id, " +
        "applications(user_info(full_name), company_candidates(full_name))",
    )
    .eq("id", interviewId)
    .maybeSingle();
  const row = data as unknown as {
    job_post_id: string;
    name: string;
    status: string;
    starts_at: string | null;
    provider_event_id: string | null;
    applications: Parameters<typeof personName>[0];
  } | null;
  if (!row) return { ok: false, error: interviewMessage("not_found") } as const;
  const denied = companyAllows(session.company, { permission: "scheduling.manage", jobId: row.job_post_id });
  if (denied) return { ok: false, error: denied } as const;
  return { ok: true, ...row, candidate: personName(row.applications) } as const;
}

async function previewReschedule(
  session: Session,
  input: z.infer<typeof rescheduleToolSchema>,
): Promise<SchedulingPreview> {
  const i = await interviewContext(session, input.interviewId);
  if (!i.ok) return fail(i.error);
  const rows: SchedulingPreviewRow[] = [
    { label: "Candidate", value: i.candidate },
    { label: "Interview", value: i.name },
  ];
  if (input.startsAt) {
    if (i.starts_at) rows.push({ label: "Was", value: i.starts_at, time: true });
    rows.push({ label: "Moves to", value: input.startsAt, time: true });
  }
  if (input.interviewerIds) {
    rows.push({ label: "Interviewers", value: namesOf(input.interviewerIds, await interviewerNames(session)) });
  }
  if (input.meetingUrl !== undefined) rows.push({ label: "Meeting link", value: input.meetingUrl ?? "Removed" });
  return {
    ok: true,
    rows,
    notices: [
      i.provider_event_id
        ? "Google Calendar emails the attendees about the change."
        : "Nobody is emailed: tell the people involved yourself.",
      ...(input.interviewerIds ? ["Draft scorecards of anyone removed are deleted; submitted ones stay."] : []),
    ],
  };
}

async function previewCancel(session: Session, input: z.infer<typeof interviewIdToolSchema>): Promise<SchedulingPreview> {
  const i = await interviewContext(session, input.interviewId);
  if (!i.ok) return fail(i.error);
  const rows: SchedulingPreviewRow[] = [
    { label: "Candidate", value: i.candidate },
    { label: "Interview", value: i.name },
    ...(i.starts_at ? [{ label: "When", value: i.starts_at, time: true }] : []),
  ];
  const notice = i.provider_event_id
    ? "The event is removed and Google Calendar emails the attendees."
    : i.status === "awaiting_candidate"
      ? "The candidate's scheduling link stops working. Nobody is emailed."
      : "Nobody is emailed.";
  return { ok: true, rows, notices: [notice, "The interviewers lose the interview kit."] };
}

async function previewRemind(session: Session, input: z.infer<typeof interviewIdToolSchema>): Promise<SchedulingPreview> {
  // interviewer_reminders checks scheduling.manage for the interview's job.
  const r = await previewReminders(session.supabase, input.interviewId);
  if (!r.ok) return fail(r.error);
  const skipped = r.skipped.map((s) => `${s.name} (${s.reason === "submitted" ? "submitted" : "reminded in the last 24 hours"})`);
  return {
    ok: true,
    rows: [
      { label: "Candidate", value: r.candidateName ?? "The candidate" },
      { label: "Interview", value: r.interviewName },
      { label: "Emails", value: r.due.length > 0 ? r.due.map((m) => m.name).join(", ") : "Nobody" },
      ...(skipped.length > 0 ? [{ label: "Not emailed", value: skipped.join(", ") }] : []),
    ],
    notices: ["Each interviewer gets an email with a link to their scorecard."],
    ...(r.due.length === 0 ? { warning: "Nobody would be emailed." } : {}),
  };
}

async function previewSavePlan(session: Session, input: z.infer<typeof savePlanToolSchema>): Promise<SchedulingPreview> {
  const denied = companyAllows(session.company, { permission: "interview_plans.manage", jobId: input.jobPostId });
  if (denied) return fail(denied);
  const [{ data: job }, { data: stages }, { count }] = await Promise.all([
    session.supabase
      .from("job_postings")
      .select("title")
      .eq("id", input.jobPostId)
      .eq("company_id", session.company.id)
      .maybeSingle(),
    session.supabase.from("pipeline_stages").select("id, name").eq("company_id", session.company.id),
    session.supabase
      .from("job_interview_plan_items")
      .select("id", { count: "exact", head: true })
      .eq("job_post_id", input.jobPostId),
  ]);
  if (!job) return fail("Job posting not found.");
  const stageName = new Map((stages ?? []).map((s) => [s.id, s.name]));
  const rows: SchedulingPreviewRow[] = [{ label: "Job", value: job.title }];
  for (const item of input.interviews) {
    const n = item.competencies.length;
    rows.push({
      label: stageName.get(item.stageId) ?? "Unknown stage",
      value: `${item.name} · ${item.durationMinutes} min · ${n} ${n === 1 ? "competency" : "competencies"}`,
    });
  }
  const current = count ?? 0;
  return {
    ok: true,
    rows,
    notices: [
      current > 0
        ? `Replaces the job's current plan (${current} ${current === 1 ? "interview" : "interviews"}). Interviews already scheduled keep their own copy.`
        : "Becomes the job's interview plan.",
    ],
    ...(input.interviews.length === 0 ? { warning: "This removes every interview from the plan." } : {}),
  };
}

/** The preview for a proposed scheduling call. */
export async function previewAgentScheduling(
  session: Session,
  tool: SchedulingPreviewTool,
  input: unknown,
): Promise<SchedulingPreview> {
  // At any scope first, so a member without it reads nothing; each preview
  // then checks the key for the job it touches.
  const denied = companyAllows(session.company, {
    permission: tool === "saveInterviewPlan" ? "interview_plans.manage" : "scheduling.manage",
  });
  if (denied) return fail(denied);
  switch (tool) {
    case "scheduleInterview": {
      const parsed = scheduleToolSchema.safeParse(input);
      return parsed.success ? previewSchedule(session, parsed.data) : NOT_READABLE;
    }
    case "sendSchedulingLink": {
      const parsed = sendLinkToolSchema.safeParse(input);
      return parsed.success ? previewSendLink(session, parsed.data) : NOT_READABLE;
    }
    case "rescheduleInterview": {
      const parsed = rescheduleToolSchema.safeParse(input);
      return parsed.success ? previewReschedule(session, parsed.data) : NOT_READABLE;
    }
    case "cancelInterview": {
      const parsed = interviewIdToolSchema.safeParse(input);
      return parsed.success ? previewCancel(session, parsed.data) : NOT_READABLE;
    }
    case "remindInterviewers": {
      const parsed = interviewIdToolSchema.safeParse(input);
      return parsed.success ? previewRemind(session, parsed.data) : NOT_READABLE;
    }
    case "saveInterviewPlan": {
      const parsed = savePlanToolSchema.safeParse(input);
      return parsed.success ? previewSavePlan(session, parsed.data) : NOT_READABLE;
    }
  }
}
