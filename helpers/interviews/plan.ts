import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/utils/types/database.types";
import { planMessage } from "./copy";
import { planItemsByStage, type StagePlanItems } from "./schedule-prompt";
import { planInputSchema, screenPlanFairness } from "./plan-schema";

export { planInputSchema, screenPlanFairness, type PlanInput, type PlanItemInput } from "./plan-schema";

type Db = SupabaseClient<Database>;

export type PlanCompetency = Pick<
  Tables<"job_interview_competencies">,
  "id" | "position" | "name" | "description" | "questions"
>;
export type PlanItem = Pick<
  Tables<"job_interview_plan_items">,
  "id" | "stage_id" | "position" | "name" | "duration_minutes" | "instructions" | "default_interviewer_ids"
> & { competencies: PlanCompetency[] };

const PLAN_COLUMNS =
  "id, stage_id, position, name, duration_minutes, instructions, default_interviewer_ids, " +
  "job_interview_competencies(id, position, name, description, questions)";

type RpcResult = { ok: boolean; reason?: string; items?: number; dropped_interviewer_ids?: string[] };

/**
 * A job's interview plan in order (IV-REQ-001). Reads through RLS, so it's
 * empty unless the caller has `scheduling.view` or `interview_plans.manage`
 * on the job.
 */
export async function loadInterviewPlan(supabase: Db, jobPostId: string): Promise<PlanItem[]> {
  const { data, error } = await supabase
    .from("job_interview_plan_items")
    .select(PLAN_COLUMNS)
    .eq("job_post_id", jobPostId)
    .order("position", { ascending: true });
  if (error) throw new Error(`Couldn't load the interview plan: ${error.message}`);
  const rows = (data ?? []) as unknown as (Omit<PlanItem, "competencies"> & {
    job_interview_competencies: PlanCompetency[] | null;
  })[];
  return rows.map(({ job_interview_competencies, ...item }) => ({
    ...item,
    competencies: [...(job_interview_competencies ?? [])].sort((a, b) => a.position - b.position),
  }));
}

export type SavePlanResult = { ok: true } | { ok: false; error: string; field?: string };

/**
 * Validates, screens and saves a job's whole plan (IV-REQ-001–003). The RPC
 * checks `interview_plans.manage` on the job, the stages and the
 * interviewers again, and keeps the ids that are sent.
 */
export async function saveInterviewPlan(supabase: Db, jobPostId: string, input: unknown): Promise<SavePlanResult> {
  const parsed = planInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: issue.path.join(".") };
  }
  const fairness = screenPlanFairness(parsed.data);
  if (!fairness.ok) return fairness;

  const { data, error } = await supabase.rpc("save_interview_plan", {
    p_job_post_id: jobPostId,
    p_items: parsed.data,
  });
  if (error) throw new Error(`Couldn't save the interview plan: ${error.message}`);
  const result = data as unknown as RpcResult;
  return result.ok ? { ok: true } : { ok: false, error: planMessage(result.reason ?? "") };
}

export type CopyPlanResult = { ok: true; items: number; droppedInterviewerIds: string[] } | { ok: false; error: string };

/**
 * Replaces `toJobId`'s plan with a copy of `fromJobId`'s (IV-REQ-004).
 * Default interviewers who can't view the target job are dropped and
 * returned, so the page can say so.
 */
export async function copyInterviewPlan(
  supabase: Db,
  { fromJobId, toJobId }: { fromJobId: string; toJobId: string },
): Promise<CopyPlanResult> {
  const { data, error } = await supabase.rpc("copy_interview_plan", { p_from_job: fromJobId, p_to_job: toJobId });
  if (error) throw new Error(`Couldn't copy the interview plan: ${error.message}`);
  const result = data as unknown as RpcResult;
  if (!result.ok) return { ok: false, error: planMessage(result.reason ?? "") };
  return { ok: true, items: result.items ?? 0, droppedInterviewerIds: result.dropped_interviewer_ids ?? [] };
}

/**
 * D8 (IVT-072): the job's plan interviews by stage, for the board's and the
 * stage picker's "Schedule …" prompt. Extra: a failed read offers none.
 */
export async function loadSchedulingPlan(supabase: Db, jobPostId: string): Promise<StagePlanItems> {
  try {
    return planItemsByStage(await loadInterviewPlan(supabase, jobPostId));
  } catch {
    return {};
  }
}
