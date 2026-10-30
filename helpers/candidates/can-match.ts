import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { candidateEmbeddingText, type EmbeddedCandidate } from "./embedding-text";

/**
 * Whether the candidate has enough to be embedded and matched to jobs
 * (CP-REQ-041): the same rule as the embedding text, from the row rather than
 * the embedding column, so it's right before the worker has run. The candidate
 * page doesn't load the parsed resume, so it's read only when there's no title
 * and no skills. A failed read says they can match: the note is a hint.
 */
export async function candidateCanMatch(
  supabase: SupabaseClient<Database>,
  candidate: { id: string } & Omit<EmbeddedCandidate, "resume_content">,
): Promise<boolean> {
  if (candidateEmbeddingText({ ...candidate, resume_content: null }) !== null) return true;
  const { data, error } = await supabase
    .from("company_candidates")
    .select("resume_content")
    .eq("id", candidate.id)
    .maybeSingle();
  if (error) return true;
  return candidateEmbeddingText({ ...candidate, resume_content: data?.resume_content ?? null }) !== null;
}
