import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { scopeToJobs } from "@/helpers/companies/job-scope";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { POOL_MATCH_LIMIT } from "@/helpers/matching/config";
import { poolMatchScore } from "./pool-match";

// Reads of the match RPCs (supabase/migrations/20261026130000_candidate_pool_matching.sql),
// for the job page, the candidate page, the Candidates table and the agent.
// The RPCs check the company and the permissions themselves.

/** One of the company's candidates matching a job (CP-REQ-060). Never contact details. */
export type PoolMatch = {
  id: string;
  name: string;
  title: string | null;
  location: string | null;
  experienceYears: number | null;
  skills: string[];
  hasEmail: boolean;
  hasResume: boolean;
  similarity: number;
  /** 0–100, labelled "Similarity" (CP-REQ-051). */
  score: number;
};

export type PoolMatches =
  | { ok: false; error: string }
  | {
      ok: true;
      /** The job isn't embedded yet; the company has no embedded candidates; or matched. */
      status: "no_job_embedding" | "no_pool" | "ok";
      /** The company's embedded candidates. */
      poolSize: number;
      matches: PoolMatch[];
    };

/** One of the company's jobs a candidate matches (CP-REQ-062). */
export type MatchingJob = { jobId: string; title: string; similarity: number; score: number };

export type MatchingJobs =
  | { ok: false; error: string }
  | { ok: true; status: "not_embedded" | "ok"; matches: MatchingJob[] };

export const POOL_MATCH_MESSAGES: Record<string, string> = {
  not_found: "Not found. It may have been deleted.",
  forbidden: forbiddenMessage("talent.view"),
};
const LOAD_ERROR = "Couldn't load matches. Try again.";

type RpcResult = {
  ok?: boolean;
  reason?: string;
  job_embedded?: boolean;
  candidate_embedded?: boolean;
  pool_size?: number;
  matches?: Record<string, unknown>[];
};

const refusal = (data: RpcResult | null) => ({
  ok: false as const,
  error: (data?.reason && POOL_MATCH_MESSAGES[data.reason]) || LOAD_ERROR,
});

/**
 * The company's candidates matching `jobId`, highest first, with what the
 * job page's card and the agent show. Errors become `{ ok: false }`.
 */
export async function listPoolMatches(
  supabase: SupabaseClient<Database>,
  jobId: string,
  { limit = POOL_MATCH_LIMIT }: { limit?: number } = {},
): Promise<PoolMatches> {
  const { data: raw, error } = await supabase.rpc("match_company_candidates", { p_job_id: jobId, p_limit: limit });
  const data = raw as RpcResult | null;
  if (error || !data?.ok) return refusal(error ? null : data);

  const poolSize = data.pool_size ?? 0;
  if (!data.job_embedded) return { ok: true, status: "no_job_embedding", poolSize, matches: [] };
  if (poolSize === 0) return { ok: true, status: "no_pool", poolSize, matches: [] };
  const hits = (data.matches ?? []).map((m) => ({
    id: String(m.company_candidate_id),
    similarity: Number(m.similarity),
    hasEmail: m.has_email === true,
    hasResume: m.has_resume === true,
  }));
  if (hits.length === 0) return { ok: true, status: "ok", poolSize, matches: [] };

  const { data: rows, error: rowsError } = await supabase
    .from("company_candidates")
    .select("id, full_name, current_title, location, experience_years, skills")
    .in(
      "id",
      hits.map((h) => h.id),
    );
  if (rowsError) return refusal(null);
  const rowOf = new Map((rows ?? []).map((r) => [r.id, r]));

  return {
    ok: true,
    status: "ok",
    poolSize,
    matches: hits.flatMap((hit) => {
      const row = rowOf.get(hit.id);
      return row
        ? [
            {
              id: hit.id,
              name: row.full_name,
              title: row.current_title,
              location: row.location,
              experienceYears: row.experience_years,
              skills: row.skills,
              hasEmail: hit.hasEmail,
              hasResume: hit.hasResume,
              similarity: hit.similarity,
              score: poolMatchScore(hit.similarity),
            },
          ]
        : [];
    }),
  };
}

/** The company's active jobs `candidateId` matches, highest first. */
export async function listMatchingJobs(
  supabase: SupabaseClient<Database>,
  candidateId: string,
): Promise<MatchingJobs> {
  const { data: raw, error } = await supabase.rpc("match_jobs_for_company_candidate", { p_candidate_id: candidateId });
  const data = raw as RpcResult | null;
  if (error || !data?.ok) return refusal(error ? null : data);
  if (!data.candidate_embedded) return { ok: true, status: "not_embedded", matches: [] };

  const hits = (data.matches ?? []).map((m) => ({ jobId: String(m.job_post_id), similarity: Number(m.similarity) }));
  if (hits.length === 0) return { ok: true, status: "ok", matches: [] };
  const { data: jobs, error: jobsError } = await supabase
    .from("job_postings")
    .select("id, title")
    .in(
      "id",
      hits.map((h) => h.jobId),
    );
  if (jobsError) return refusal(null);
  const titleOf = new Map((jobs ?? []).map((j) => [j.id, j.title]));

  return {
    ok: true,
    status: "ok",
    matches: hits.flatMap((hit) => {
      const title = titleOf.get(hit.jobId);
      return title === undefined ? [] : [{ ...hit, title, score: poolMatchScore(hit.similarity) }];
    }),
  };
}

/**
 * Whether the company has an active job the member can see, which matching
 * needs. On an error it says yes, so the page falls back to the usual notes.
 */
export async function hasActiveJobs(supabase: SupabaseClient<Database>, company: MyCompany): Promise<boolean> {
  const { data, error } = await scopeToJobs(
    supabase.from("job_postings").select("id").eq("company_id", company.id).eq("status", "active"),
    company,
  ).limit(1);
  return error ? true : (data ?? []).length > 0;
}
