"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { can } from "@/helpers/companies/permissions";
import { loadQuestionSets } from "@/helpers/jobs/load-question-sets";
import type { QuestionSet } from "@/helpers/jobs/question-sets";

/** SERVER ACTION (AF-REQ-004): the company's question sets, and whether the caller can manage them. */
export async function listQuestionSetsAction(): Promise<
  { ok: true; sets: QuestionSet[]; canManage: boolean } | { ok: false; error: string }
> {
  const auth = await requireCompanyForAction({ permission: "jobs.view" });
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase, company } = auth;

  const sets = await loadQuestionSets(supabase, company.id);
  if (!sets) return { ok: false, error: "Couldn't load the question sets." };
  return { ok: true, sets, canManage: can(company, "question_sets.manage") };
}
