import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { screenInterviewConfigFairness } from "./config-fairness";
import { interviewConfigSchema, type InterviewConfig } from "./schemas";

const CONFIG_COLUMNS =
  "enabled, invite_rule, fit_threshold, questions, competencies, duration_minutes, deadline_days, language";

export type SaveInterviewConfigResult =
  | { ok: true; config: InterviewConfig }
  | { ok: false; error: string; field?: string };

/**
 * A job's AI interview config, or null when it has none. Reads through RLS,
 * so the caller sees it only with interviews.view on the job.
 */
export async function getInterviewConfig(
  supabase: SupabaseClient<Database>,
  jobPostId: string,
): Promise<InterviewConfig | null> {
  const { data, error } = await supabase
    .from("job_interview_configs")
    .select(CONFIG_COLUMNS)
    .eq("job_post_id", jobPostId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't load the interview config: ${error.message}`);
  return (data as InterviewConfig | null) ?? null;
}

/**
 * Validates and saves a job's config (SI-REQ-001/003, SI-SEC-006). The
 * company is the session's; the DB also takes it from the job and checks
 * interviews.manage and jobs.edit. Invites already sent keep their snapshot.
 */
export async function saveInterviewConfig(
  supabase: SupabaseClient<Database>,
  { companyId, jobPostId }: { companyId: string; jobPostId: string },
  input: unknown,
): Promise<SaveInterviewConfigResult> {
  const parsed = interviewConfigSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: issue.path.join(".") };
  }

  const fairness = screenInterviewConfigFairness(parsed.data);
  if (!fairness.ok) return fairness;

  const { data, error } = await supabase
    .from("job_interview_configs")
    .upsert({ job_post_id: jobPostId, company_id: companyId, ...parsed.data }, { onConflict: "job_post_id" })
    .select(CONFIG_COLUMNS)
    .single();
  if (error) {
    if (error.code === "42501") {
      return { ok: false, error: "Your role can't set up AI interviews for this job." };
    }
    throw new Error(`Couldn't save the interview config: ${error.message}`);
  }
  return { ok: true, config: data as InterviewConfig };
}
