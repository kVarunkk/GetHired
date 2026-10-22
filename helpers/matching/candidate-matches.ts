import { reportError } from "@/helpers/posthog/report-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { parseStoredExplanation, type MatchExplanation } from "./schemas";

/** One of the company's jobs a candidate matches, as the profile page shows it. */
export type CandidateMatch = {
  jobPostId: string;
  jobTitle: string;
  /** Null for the job in context when the digest didn't match the candidate. */
  matchScore: number | null;
  /** A completed explanation, or null. */
  explanation: MatchExplanation | null;
};

/**
 * The candidate's matches across the company's jobs, for the profile page
 * (MT-REQ-004). Use the session client: RLS and the explicit company filter
 * both scope it to the company. The job in context comes first (and is added
 * without a score when the digest didn't match the candidate to it, if it's
 * the company's), then the rest by score, highest first. Only completed
 * explanations are returned; a stale one shows "Why this match?" again.
 * Returns [] on a query error so the profile still renders.
 */
export async function getCandidateMatches(
  supabase: SupabaseClient<Database>,
  candidateId: string,
  companyId: string,
  focusJobPostId?: string,
): Promise<CandidateMatch[]> {
  const { data, error } = await supabase
    .from("job_relevant_profiles")
    .select("match_score, explanation, explanation_status, job_postings!inner(id, title, company_id)")
    .eq("user_id", candidateId)
    .eq("job_postings.company_id", companyId);
  if (error) {
    reportError("[profile matches] couldn't load matches", error.message);
    return [];
  }

  const matches: CandidateMatch[] = (data ?? [])
    .filter((row) => row.job_postings)
    .map((row) => ({
      jobPostId: row.job_postings.id,
      jobTitle: row.job_postings.title,
      matchScore: row.match_score,
      explanation:
        row.explanation_status === "completed" ? parseStoredExplanation(row.explanation) : null,
    }))
    .sort(
      (a, b) =>
        (b.matchScore ?? -1) - (a.matchScore ?? -1) || a.jobTitle.localeCompare(b.jobTitle),
    );

  if (!focusJobPostId) return matches;

  const focused = matches.find((m) => m.jobPostId === focusJobPostId);
  if (focused) return [focused, ...matches.filter((m) => m !== focused)];

  const { data: job } = await supabase
    .from("job_postings")
    .select("id, title")
    .eq("id", focusJobPostId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!job) return matches;

  return [{ jobPostId: job.id, jobTitle: job.title, matchScore: null, explanation: null }, ...matches];
}
