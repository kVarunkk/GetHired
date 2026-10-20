import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { toQuestionSet, type QuestionSet } from "./question-sets";

/** The company's question sets by name, or null on a read error. Rows that no longer validate are skipped. */
export async function loadQuestionSets(
  supabase: SupabaseClient<Database>,
  companyId: string,
): Promise<QuestionSet[] | null> {
  const { data, error } = await supabase
    .from("company_question_sets")
    .select("id, name, form, updated_at")
    .eq("company_id", companyId)
    .order("name", { ascending: true });
  if (error) return null;
  return (data ?? []).map(toQuestionSet).filter((s): s is QuestionSet => s !== null);
}
