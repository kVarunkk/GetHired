import "server-only";
import { randomUUID } from "node:crypto";
import { assertAllowance, consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import type { CompanySessionContext } from "@/helpers/companies/company-session";
import { draftInterviewPlan, type DraftPlanResult, type DraftStage } from "./ai/draft-plan";
import { PLAN_DRAFT_COST } from "./config";

export type DraftForJobResult = DraftPlanResult | { ok: false; entitlement: EntitlementError };

/**
 * IV-REQ-050: drafts a job's interview plan from its post, for the plan
 * editor and the agent's draftInterviewPlan. The caller has checked
 * `interview_plans.manage` on the job. Nothing is saved. One agent message is
 * charged to the session member after a usable draft, never on a failure,
 * and a company that's out is refused before the model runs. `stages` are
 * the open stages the draft could use (no Rejected or Hired).
 */
export async function draftPlanForJob(
  { supabase, company, user }: CompanySessionContext,
  jobPostId: string,
): Promise<DraftForJobResult & { stages?: DraftStage[] }> {
  const { data: job } = await supabase
    .from("job_postings")
    .select("title, description, skills")
    .eq("id", jobPostId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!job) return { ok: false, error: "Job posting not found." };

  const { data: stageRows, error: stagesError } = await supabase
    .from("pipeline_stages")
    .select("id, name, kind, archived")
    .eq("company_id", company.id)
    .order("position", { ascending: true });
  if (stagesError) throw new Error(`Couldn't load the pipeline stages: ${stagesError.message}`);
  // Rejected and Hired can't have interviews (IV-REQ-001).
  const stages = (stageRows ?? []).filter((s) => !s.archived && s.kind !== "rejected" && s.kind !== "hired");

  try {
    // A preflight, so a company that's out doesn't pay for a model call it can't use.
    await assertAllowance(company.id, "agent_messages", PLAN_DRAFT_COST, user.id);
  } catch (err) {
    if (err instanceof EntitlementError) return { ok: false, entitlement: err };
    throw err;
  }

  const draft = await draftInterviewPlan({ job, stages });
  if (!draft.ok) return draft;

  try {
    await consumeEntitlement(
      company.id,
      "agent_messages",
      PLAN_DRAFT_COST,
      { type: "interview_plan_draft", id: randomUUID() },
      user.id,
    );
  } catch (err) {
    if (err instanceof EntitlementError) return { ok: false, entitlement: err };
    throw err;
  }
  return { ...draft, stages };
}
