import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/utils/types/database.types";
import type { ApplicationForm } from "./application-form-schema";
import { screenFormFairness } from "./form-fairness";
import { questionSetError, toQuestionSet, type QuestionSet } from "./question-sets";

/**
 * AF-REQ-004: saves a form as a new set, or overwrites one (with `id`), for
 * the session's company. The caller checks question_sets.manage; RLS checks
 * again. Shared by the settings action and the recruiter agent.
 */
export async function saveQuestionSet(
  supabase: SupabaseClient<Database>,
  companyId: string,
  { id, name, form }: { id?: string; name: string; form: ApplicationForm },
): Promise<{ ok: true; set: QuestionSet } | { ok: false; error: string }> {
  const fairness = screenFormFairness(form);
  if (!fairness.ok) return { ok: false, error: fairness.error };

  // Archived questions belong to a job's history, not to a reusable set.
  const stored = { ...form, questions: form.questions.filter((q) => !q.archived) } as unknown as Json;
  const write = id
    ? supabase
        .from("company_question_sets")
        .update({ name, form: stored, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("company_id", companyId)
    : supabase.from("company_question_sets").insert({ company_id: companyId, name, form: stored });
  const { data, error } = await write.select("id, name, form, updated_at").maybeSingle();
  if (error) return { ok: false, error: questionSetError(error) };
  const set = data ? toQuestionSet(data) : null;
  if (!set) return { ok: false, error: "Question set not found." };
  return { ok: true, set };
}

/** Deletes one of the company's sets. Jobs it was applied to keep their copy. */
export async function deleteQuestionSet(
  supabase: SupabaseClient<Database>,
  companyId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("company_question_sets").delete().eq("id", id).eq("company_id", companyId);
  if (error) return { ok: false, error: "Couldn't delete the question set." };
  return { ok: true };
}
