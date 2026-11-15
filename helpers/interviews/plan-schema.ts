import { z } from "zod";
import { screenFairnessText } from "@/helpers/ai/fairness";
import { PANEL_MAX, PLAN_LIMITS } from "./config";

// Client-safe (IVT-012): the plan editor validates with the same schema the
// action does. `save_interview_plan` checks the same limits in SQL
// (`config.test.ts` keeps them in step).

const trimmed = (max: number, required: string, tooLong: string) =>
  z.string().trim().min(1, required).max(max, tooLong);

const competencySchema = z
  .object({
    /** Sent back on save so the id stays stable (IV-REQ-003); a new competency has none. */
    id: z.string().uuid().optional(),
    name: trimmed(
      PLAN_LIMITS.competencyName,
      "Give the competency a name.",
      `Keep competency names under ${PLAN_LIMITS.competencyName} characters.`,
    ),
    description: z
      .string()
      .trim()
      .max(PLAN_LIMITS.competencyDescription, `Keep descriptions under ${PLAN_LIMITS.competencyDescription} characters.`)
      .default(""),
    questions: z
      .array(z.string().trim().max(PLAN_LIMITS.question, `Keep questions under ${PLAN_LIMITS.question} characters.`))
      .default([])
      // Blank questions are dropped, as the RPC does, before the count.
      .transform((qs) => qs.filter((q) => q.length > 0))
      .refine((qs) => qs.length <= PLAN_LIMITS.questions, `Add at most ${PLAN_LIMITS.questions} questions.`),
  })
  .strict();

const planItemSchema = z
  .object({
    id: z.string().uuid().optional(),
    stage_id: z.string().uuid("Pick a stage."),
    name: trimmed(PLAN_LIMITS.name, "Give the interview a name.", `Keep names under ${PLAN_LIMITS.name} characters.`),
    duration_minutes: z
      .number()
      .int("Use whole minutes.")
      .min(PLAN_LIMITS.durationMin, `Interviews take at least ${PLAN_LIMITS.durationMin} minutes.`)
      .max(PLAN_LIMITS.durationMax, `Interviews take at most ${PLAN_LIMITS.durationMax} minutes.`)
      .default(PLAN_LIMITS.durationDefault),
    instructions: z
      .string()
      .trim()
      .max(PLAN_LIMITS.instructions, `Keep instructions under ${PLAN_LIMITS.instructions} characters.`)
      .default(""),
    default_interviewer_ids: z
      .array(z.string().uuid())
      .default([])
      .transform((ids) => [...new Set(ids)])
      .refine((ids) => ids.length <= PANEL_MAX, `Pick at most ${PANEL_MAX} interviewers.`),
    competencies: z
      .array(competencySchema)
      .min(PLAN_LIMITS.competenciesMin, "Add at least one competency.")
      .max(PLAN_LIMITS.competenciesMax, `Add at most ${PLAN_LIMITS.competenciesMax} competencies.`),
  })
  .strict();

/** A job's whole interview plan, in order (IV-REQ-001–003). */
export const planInputSchema = z
  .array(planItemSchema)
  .max(PLAN_LIMITS.items, `A plan has at most ${PLAN_LIMITS.items} interviews.`);

export type PlanInput = z.output<typeof planInputSchema>;
export type PlanItemInput = PlanInput[number];

/** A competency in an AI draft (IV-REQ-050): no id until it's saved. */
export type PlanDraftCompetency = { name: string; description: string; questions: string[] };

/** An interview in an AI draft (IV-REQ-050). The editor fills it in; nothing is saved until Save. */
export type PlanDraftItem = {
  stage_id: string;
  name: string;
  duration_minutes: number;
  instructions: string;
  competencies: PlanDraftCompetency[];
};

/**
 * Plan text guides interviewers, so it may not ask about or weigh a protected
 * characteristic. Any mention counts (the strict `candidate_filter` context),
 * as for application questions. `field` is the zod-style path of the text.
 */
export function screenPlanFairness(
  plan: PlanInput,
): { ok: true } | { ok: false; error: string; field: string } {
  for (const [i, item] of plan.entries()) {
    const texts: [string, string][] = [
      [`${i}.name`, item.name],
      [`${i}.instructions`, item.instructions],
    ];
    for (const [c, comp] of item.competencies.entries()) {
      texts.push([`${i}.competencies.${c}.name`, comp.name], [`${i}.competencies.${c}.description`, comp.description]);
      for (const [q, question] of comp.questions.entries()) {
        texts.push([`${i}.competencies.${c}.questions.${q}`, question]);
      }
    }
    for (const [field, text] of texts) {
      const result = screenFairnessText(text, { context: "candidate_filter" });
      if (!result.ok) {
        return { ok: false, field, error: `Interview plans can't ask about ${result.term}. Change "${text}".` };
      }
    }
  }
  return { ok: true };
}
