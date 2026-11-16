import { z } from "zod";
import { Constants } from "@/utils/types/database.types";
import { AD_HOC_NAME_MAX, PANEL_MAX, PLAN_LIMITS, SCORECARD_LIMITS } from "./config";

// Client-safe (IVT-018): the Record interview dialog, the scorecard form and
// the actions validate with the same schemas. The RPCs check them again.

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true, message: "Pick when the interview starts." });
const meetingUrl = z
  .string()
  .trim()
  .max(2000, "Use a shorter meeting link.")
  .regex(/^https?:\/\//i, "Use a meeting link that starts with https://.");
const panel = z
  .array(uuid)
  .transform((ids) => [...new Set(ids)])
  .refine((ids) => ids.length >= 1 && ids.length <= PANEL_MAX, `Pick 1 to ${PANEL_MAX} interviewers.`);

/**
 * "Record interview" (IV-REQ-020 manual): a plan interview, or an ad-hoc one
 * with a name and a length.
 */
export const recordInterviewSchema = z
  .object({
    applicationId: uuid,
    planItemId: uuid.nullish(),
    name: z.string().trim().max(AD_HOC_NAME_MAX, `Keep names under ${AD_HOC_NAME_MAX} characters.`).nullish(),
    durationMinutes: z
      .number()
      .int("Use whole minutes.")
      .min(PLAN_LIMITS.durationMin, `Interviews take at least ${PLAN_LIMITS.durationMin} minutes.`)
      .max(PLAN_LIMITS.durationMax, `Interviews take at most ${PLAN_LIMITS.durationMax} minutes.`)
      .nullish(),
    panel,
    startsAt: instant,
    meetingUrl: meetingUrl.or(z.literal("")).nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.planItemId) return;
    if (!v.name) ctx.addIssue({ code: "custom", path: ["name"], message: "Give the interview a name." });
    if (v.durationMinutes == null) {
      ctx.addIssue({ code: "custom", path: ["durationMinutes"], message: "Pick how long it takes." });
    }
  });
export type RecordInterviewInput = z.input<typeof recordInterviewSchema>;

/** Reschedule, change the panel or the meeting link (IV-REQ-023). `meetingUrl: null` clears it. */
export const updateInterviewSchema = z
  .object({
    interviewId: uuid,
    startsAt: instant.optional(),
    panel: panel.optional(),
    meetingUrl: meetingUrl.or(z.literal("")).nullable().optional(),
  })
  .strict()
  .refine((v) => v.startsAt !== undefined || v.panel !== undefined || v.meetingUrl !== undefined, "Nothing to change.");
export type UpdateInterviewInput = z.input<typeof updateInterviewSchema>;

export const markInterviewSchema = z
  .object({ interviewId: uuid, status: z.enum(["completed", "no_show"]) })
  .strict();

const rating = z.enum(Constants.public.Enums.candidate_rating);

/**
 * A scorecard autosave (IV-REQ-030): ratings keyed by the snapshot's
 * competency ids, each with an optional rating and note, plus the overall.
 */
export const scorecardDraftSchema = z
  .object({
    interviewId: uuid,
    ratings: z.record(
      uuid,
      z
        .object({
          rating: rating.nullable(),
          note: z.string().max(SCORECARD_LIMITS.competencyNote, "Keep notes shorter.").default(""),
        })
        .strict(),
    ),
    overall: rating.nullable(),
    overallNote: z.string().max(SCORECARD_LIMITS.overallNote, "Keep your notes shorter.").default(""),
  })
  .strict();
export type ScorecardDraftInput = z.input<typeof scorecardDraftSchema>;
