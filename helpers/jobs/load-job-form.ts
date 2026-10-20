import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { legacyQuestionId, readApplicationForm, type ApplicationForm } from "./application-form-schema";
import { withRules } from "./public-application-form";

/** How many applications to read for the answered-question ids. */
const ANSWER_SAMPLE = 500;

/**
 * AF-REQ-005: a job's full form: the stored form with its knockout rules
 * (company-only, AF-SEC-003) and the questions that already have answers, so
 * replacing or retyping them archives them. Null when the job isn't the
 * company's. Shared by the form builder's action and the recruiter agent.
 */
export async function loadJobForm(
  supabase: SupabaseClient<Database>,
  companyId: string,
  jobPostId: string,
): Promise<{ form: ApplicationForm; answeredQuestionIds: string[] } | null> {
  const { data: job } = await supabase
    .from("job_postings")
    .select("id, questions, application_form")
    .eq("id", jobPostId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!job) return null;

  const [{ data: ruleRow }, answeredQuestionIds] = await Promise.all([
    supabase.from("job_posting_form_rules").select("rules").eq("job_post_id", jobPostId).maybeSingle(),
    loadAnsweredQuestionIds(supabase, jobPostId),
  ]);

  return {
    form: withRules(readApplicationForm(job.application_form, job.questions), ruleRow?.rules ?? null),
    answeredQuestionIds,
  };
}

/** The ids of the job's questions that applications have answered (standard fields excluded). */
export async function loadAnsweredQuestionIds(supabase: SupabaseClient<Database>, jobPostId: string): Promise<string[]> {
  const { data: answered } = await supabase
    .from("applications")
    .select("answers, answers_v2")
    .eq("job_post_id", jobPostId)
    .limit(ANSWER_SAMPLE);

  const ids = new Set<string>();
  for (const row of answered ?? []) {
    if (row.answers_v2 && typeof row.answers_v2 === "object" && !Array.isArray(row.answers_v2)) {
      for (const key of Object.keys(row.answers_v2)) ids.add(key);
    } else {
      // An old application: its i-th answer belongs to the i-th legacy question.
      (row.answers ?? []).forEach((_, i) => ids.add(legacyQuestionId(i)));
    }
  }
  return [...ids].filter((key) => !key.startsWith("std:"));
}
