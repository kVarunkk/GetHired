import { z } from "zod";
import { MAX_TEMPLATE_BODY, MAX_TEMPLATE_SUBJECT } from "@/helpers/pipeline/templates";
import { AD_HOC_NAME_MAX, PANEL_MAX, PLAN_LIMITS } from "./config";

// Client-safe (IVT-042/043): the scheduler and its actions validate with the
// same schemas. book_interview checks them again.

const uuid = z.string().uuid();
const panel = z
  .array(uuid)
  .transform((ids) => [...new Set(ids)])
  .refine((ids) => ids.length >= 1 && ids.length <= PANEL_MAX, `Pick 1 to ${PANEL_MAX} interviewers.`);
const duration = z
  .number()
  .int("Use whole minutes.")
  .min(PLAN_LIMITS.durationMin, `Interviews take at least ${PLAN_LIMITS.durationMin} minutes.`)
  .max(PLAN_LIMITS.durationMax, `Interviews take at most ${PLAN_LIMITS.durationMax} minutes.`);

export const findSlotsSchema = z
  .object({ jobPostId: uuid, panel, durationMinutes: duration })
  .strict();
export type FindSlotsInput = z.input<typeof findSlotsSchema>;

const interviewFields = {
  applicationId: uuid,
  planItemId: uuid.nullish(),
  name: z.string().trim().max(AD_HOC_NAME_MAX, `Keep names under ${AD_HOC_NAME_MAX} characters.`).nullish(),
  durationMinutes: duration.nullish(),
  panel,
};

/** A plan interview, or an ad-hoc one with a name and a length. */
function planOrAdHoc(v: { planItemId?: string | null; name?: string | null; durationMinutes?: number | null }, ctx: z.RefinementCtx) {
  if (v.planItemId) return;
  if (!v.name) ctx.addIssue({ code: "custom", path: ["name"], message: "Give the interview a name." });
  if (v.durationMinutes == null) {
    ctx.addIssue({ code: "custom", path: ["durationMinutes"], message: "Pick how long it takes." });
  }
}

/** "Book" (IV-REQ-020): a plan interview or an ad-hoc one, a panel and a slot. */
export const bookInterviewSchema = z
  .object({ ...interviewFields, startsAt: z.string().datetime({ offset: true, message: "Pick a time." }) })
  .strict()
  .superRefine(planOrAdHoc);
export type BookInterviewInput = z.input<typeof bookInterviewSchema>;

/**
 * "Send a link" (IV-REQ-020, IVT-062): the interview and panel, and the
 * email: one of the company's templates, with the subject and body as edited.
 */
const linkEmail = {
  templateId: uuid,
  subject: z.string().max(MAX_TEMPLATE_SUBJECT, `Keep the subject under ${MAX_TEMPLATE_SUBJECT} characters.`).optional(),
  body: z.string().max(MAX_TEMPLATE_BODY, "Keep the message under 5,000 characters.").optional(),
};

export const sendLinkSchema = z
  .object({ ...interviewFields, ...linkEmail })
  .strict()
  .superRefine(planOrAdHoc);
export type SendLinkInput = z.input<typeof sendLinkSchema>;

/** A company email template a link can go out with (interview invites first). */
export type LinkTemplate = { id: string; name: string; subject: string; body: string };

/** The link email has to carry the link; the scheduler and the send check it. */
const HAS_LINK = /\{\{\s*scheduling_link\s*\}\}/;
export const hasSchedulingLink = (body: string) => HAS_LINK.test(body);

/** "Resend" (with an email) or "Copy link" (without) on a link interview (IVT-065). */
export const renewLinkSchema = z
  .object({ interviewId: uuid, email: z.object(linkEmail).strict().optional() })
  .strict();
export type RenewLinkInput = z.input<typeof renewLinkSchema>;
