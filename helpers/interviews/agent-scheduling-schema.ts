import { z } from "zod";
import { AD_HOC_NAME_MAX, PANEL_MAX, PLAN_LIMITS } from "./config";

// Client-safe (IVT-082): the recruiter agent's scheduling tools, their
// approval cards' previews and MCP parse the same inputs. The helpers behind
// them validate again with the app's own schemas. Inputs never carry a
// company or a member's account: interviewers are picked from the ids the
// read tools return.

const uuid = (what: string) => z.string().uuid().describe(`The ${what}'s id.`);

const interviewerIds = z
  .array(z.string().uuid())
  .min(1)
  .max(PANEL_MAX)
  .describe(`1 to ${PANEL_MAX} interviewers, by the ids getInterviewPlan or listScheduledInterviews return.`);

const startsAt = z
  .string()
  .datetime({ offset: true })
  .describe("When it starts, as an ISO 8601 time with its offset, e.g. 2026-11-20T14:00:00+05:30.");

/** A plan interview, or an ad-hoc one with a name and a length (IV-REQ-020). */
const interviewFields = {
  applicationId: uuid("application"),
  planItemId: z
    .string()
    .uuid()
    .optional()
    .describe("The plan interview's id from getInterviewPlan. Leave out for an ad-hoc interview."),
  name: z.string().trim().min(1).max(AD_HOC_NAME_MAX).optional().describe("An ad-hoc interview's name."),
  durationMinutes: z
    .number()
    .int()
    .min(PLAN_LIMITS.durationMin)
    .max(PLAN_LIMITS.durationMax)
    .optional()
    .describe("An ad-hoc interview's length in minutes."),
  interviewerIds,
};

function planOrAdHoc(v: { planItemId?: string; name?: string; durationMinutes?: number }, ctx: z.RefinementCtx) {
  if (v.planItemId) return;
  if (!v.name) ctx.addIssue({ code: "custom", path: ["name"], message: "An ad-hoc interview needs a name." });
  if (v.durationMinutes === undefined) {
    ctx.addIssue({ code: "custom", path: ["durationMinutes"], message: "An ad-hoc interview needs a length." });
  }
}

export const findSlotsToolSchema = z
  .object({
    applicationId: uuid("application"),
    planItemId: interviewFields.planItemId,
    durationMinutes: interviewFields.durationMinutes,
    interviewerIds,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.planItemId && v.durationMinutes === undefined) {
      ctx.addIssue({ code: "custom", path: ["durationMinutes"], message: "Give a plan interview or a length." });
    }
  });
export type FindSlotsToolInput = z.infer<typeof findSlotsToolSchema>;

export const SCHEDULE_METHODS = ["book", "record"] as const;

export const scheduleToolSchema = z
  .object({
    ...interviewFields,
    startsAt,
    method: z
      .enum(SCHEDULE_METHODS)
      .default("book")
      .describe(
        "book: a Google Calendar event with a Meet link on the user's calendar (Google emails the panel and the candidate). record: an interview arranged outside GetHired; nobody is emailed.",
      ),
    meetingUrl: z
      .string()
      .url()
      .max(2000)
      .optional()
      .describe("record only: a meeting link arranged outside GetHired (https)."),
  })
  .strict()
  .superRefine(planOrAdHoc);
export type ScheduleToolInput = z.infer<typeof scheduleToolSchema>;

export const sendLinkToolSchema = z
  .object({
    ...interviewFields,
    templateId: z
      .string()
      .uuid()
      .optional()
      .describe("The email template's id from listEmailTemplates. Leave out for the company's default interview invite."),
  })
  .strict()
  .superRefine(planOrAdHoc);
export type SendLinkToolInput = z.infer<typeof sendLinkToolSchema>;

export const rescheduleToolSchema = z
  .object({
    interviewId: uuid("interview"),
    startsAt: startsAt.optional(),
    interviewerIds: interviewerIds.optional().describe("The whole new panel, when it changes."),
    meetingUrl: z.string().url().max(2000).nullable().optional().describe("A new meeting link; null removes it."),
  })
  .strict()
  .refine((v) => v.startsAt !== undefined || v.interviewerIds !== undefined || v.meetingUrl !== undefined, {
    message: "Give a new time, panel or meeting link.",
  });
export type RescheduleToolInput = z.infer<typeof rescheduleToolSchema>;

export const interviewIdToolSchema = z.object({ interviewId: uuid("interview") }).strict();

const planCompetencyInput = z
  .object({
    id: z.string().uuid().optional().describe("Keep an existing competency's id so its scorecards still match."),
    name: z.string().trim().min(1).max(PLAN_LIMITS.competencyName),
    description: z.string().trim().max(PLAN_LIMITS.competencyDescription).optional(),
    questions: z.array(z.string().trim().min(1).max(PLAN_LIMITS.question)).max(PLAN_LIMITS.questions).optional(),
  })
  .strict();

const planItemInput = z
  .object({
    id: z.string().uuid().optional().describe("Keep an existing plan interview's id; leave out for a new one."),
    stageId: z.string().uuid().describe("An open stage's id from getInterviewPlan's stages."),
    name: z.string().trim().min(1).max(PLAN_LIMITS.name),
    durationMinutes: z.number().int().min(PLAN_LIMITS.durationMin).max(PLAN_LIMITS.durationMax),
    instructions: z.string().trim().max(PLAN_LIMITS.instructions).optional(),
    defaultInterviewerIds: z
      .array(z.string().uuid())
      .max(PANEL_MAX)
      .optional()
      .describe("Interviewers prefilled when scheduling, by the ids getInterviewPlan returns."),
    competencies: z.array(planCompetencyInput).min(PLAN_LIMITS.competenciesMin).max(PLAN_LIMITS.competenciesMax),
  })
  .strict();

export const savePlanToolSchema = z
  .object({
    jobPostId: uuid("job post"),
    interviews: z
      .array(planItemInput)
      .max(PLAN_LIMITS.items)
      .describe("The job's whole plan, in order. It replaces the current one."),
  })
  .strict();
export type SavePlanToolInput = z.infer<typeof savePlanToolSchema>;

/** The tool's plan as `save_interview_plan` takes it. */
export function planItemsOf(input: SavePlanToolInput) {
  return input.interviews.map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    stage_id: item.stageId,
    name: item.name,
    duration_minutes: item.durationMinutes,
    instructions: item.instructions ?? "",
    default_interviewer_ids: item.defaultInterviewerIds ?? [],
    competencies: item.competencies.map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      name: c.name,
      description: c.description ?? "",
      questions: c.questions ?? [],
    })),
  }));
}

/** The tools that ask first and have a server preview on their approval card. */
export const SCHEDULING_PREVIEW_TOOLS = [
  "saveInterviewPlan",
  "scheduleInterview",
  "sendSchedulingLink",
  "rescheduleInterview",
  "cancelInterview",
  "remindInterviewers",
] as const;
export type SchedulingPreviewTool = (typeof SCHEDULING_PREVIEW_TOOLS)[number];

export const isSchedulingPreviewTool = (name: string): name is SchedulingPreviewTool =>
  (SCHEDULING_PREVIEW_TOOLS as readonly string[]).includes(name);

/** The question a scheduling call asks: the agent card's title and the MCP preview's summary. */
export function schedulingApprovalTitle(tool: string, input: unknown): string {
  const values = (input ?? {}) as { method?: string };
  switch (tool) {
    case "saveInterviewPlan":
      return "Save this interview plan?";
    case "scheduleInterview":
      return values.method === "record" ? "Record this interview?" : "Book this interview?";
    case "sendSchedulingLink":
      return "Email the candidate a link to pick a time?";
    case "rescheduleInterview":
      return "Change this interview?";
    case "cancelInterview":
      return "Cancel this interview?";
    case "remindInterviewers":
      return "Remind the interviewers?";
    default:
      return "Allow this change?";
  }
}

/** A preview line; `time` values are ISO instants the card shows in the viewer's zone. */
export type SchedulingPreviewRow = { label: string; value: string; time?: boolean };

export type SchedulingPreview =
  | { ok: true; rows: SchedulingPreviewRow[]; notices: string[]; warning?: string }
  | { ok: false; error: string };
