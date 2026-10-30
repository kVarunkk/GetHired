import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { isUuid } from "@/helpers/agent/auth";
import { CANDIDATE_ADDED_DAYS, type CandidateAddedDays } from "@/helpers/candidates/candidate-added-days";
import { expandLocations } from "@/helpers/locations/aliases";
import { sanitizeSearchTerm } from "@/helpers/search/sanitize-search-term";
import { poolMatchScore } from "./pool-match";

/** BI-REQ-003: rows per page of the Candidates page. */
export const CANDIDATES_PAGE_SIZE = 25;
/** CP-REQ-071: the most matches the "Match to job" filter pages over (the RPC's cap). */
export const MATCH_FILTER_LIMIT = 200;

export type CandidateFilters = {
  /** Name, email, title, company or skills (`search_text`). */
  q: string | null;
  tag: string | null;
  batchId: string | null;
  /** In at least one job, or in none. */
  inJob: "yes" | "no" | null;
  /** A place, matched with every spelling of it (`expandLocations`). */
  loc: string | null;
  /** Has a parsed resume, or none. */
  resume: "has" | "none" | null;
  /** Has an email, or none. */
  email: "has" | "none" | null;
  /** Added in the last 7, 30 or 90 days. */
  addedDays: CandidateAddedDays | null;
  /** Only the candidates matching this job, by similarity (CP-REQ-071). */
  matchJob: string | null;
  /** 1-based. */
  page: number;
  /** A talent list's members only (the list tab). */
  listId?: string | null;
};

/** One row of the Candidates table. The company's own data, so the email is in it (BI-REQ-004). */
export type CompanyCandidateListItem = {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  location: string | null;
  tags: string[];
  batch: { id: string; fileName: string | null } | null;
  jobCount: number;
  createdAt: string;
  /** The similarity to the "Match to job" filter's job, 0–100; null without it. */
  score: number | null;
};

export type CompanyCandidateList = {
  items: CompanyCandidateListItem[];
  total: number;
  page: number;
  pageSize: number;
};

const text = (value: string | undefined) => value?.trim() || null;

const hasOrNone = (value: string | undefined) => (value === "has" || value === "none" ? value : null);

/**
 * The table's filters from the page's search params (`q`, `tag`, `batch`,
 * `inJob`, `loc`, `resume`, `email`, `added`, `matchJob`, `page`). Unknown values are
 * ignored.
 */
export function candidateFiltersFrom(params: Record<string, string | undefined>): CandidateFilters {
  const page = Number.parseInt(params.page ?? "", 10);
  const inJob = params.inJob === "yes" || params.inJob === "no" ? params.inJob : null;
  const added = Number(params.added);
  return {
    q: text(params.q),
    tag: text(params.tag),
    batchId: params.batch && isUuid(params.batch) ? params.batch : null,
    inJob,
    loc: text(params.loc),
    resume: hasOrNone(params.resume),
    email: hasOrNone(params.email),
    addedDays: (CANDIDATE_ADDED_DAYS as readonly number[]).includes(added) ? (added as CandidateAddedDays) : null,
    matchJob: params.matchJob && isUuid(params.matchJob) ? params.matchJob : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One page of the company's candidates, newest first (BI-REQ-003), read
 * through RLS (talent.view, or applicants.view for the candidates in a job).
 * With `matchJob`, only those matching the job, by similarity, paged here
 * over at most `MATCH_FILTER_LIMIT` (CP-REQ-071). Never the notes, the
 * resume, the claim columns, the embedding or `search_text`. Throws on a
 * database error, or when the match RPC refuses (the caller checks the job).
 */
export async function listCompanyCandidates(
  supabase: SupabaseClient<Database>,
  companyId: string,
  filters: CandidateFilters,
): Promise<CompanyCandidateList> {
  let similarityOf: Map<string, number> | null = null;
  if (filters.matchJob) {
    const { data, error } = await supabase.rpc("match_company_candidates", {
      p_job_id: filters.matchJob,
      p_limit: MATCH_FILTER_LIMIT,
    });
    const result = data as { ok?: boolean; reason?: string; matches?: { company_candidate_id: string; similarity: number }[] } | null;
    if (error || !result?.ok) {
      throw new Error(`Failed to match the candidates: ${error?.message ?? result?.reason ?? "unknown"}`);
    }
    similarityOf = new Map((result.matches ?? []).map((m) => [m.company_candidate_id, Number(m.similarity)]));
    if (similarityOf.size === 0) {
      return { items: [], total: 0, page: filters.page, pageSize: CANDIDATES_PAGE_SIZE };
    }
  }

  const embeds = [
    "candidate_import_batches!company_candidates_source_batch_id_fkey(file_name)",
    "applications(count)",
    // Filter-only embeds: `!inner` keeps rows that have one; a plain embed
    // filtered `is null` keeps rows that have none.
    ...(filters.inJob === "yes" ? ["in_job:applications!inner(id)"] : []),
    ...(filters.inJob === "no" ? ["in_job:applications(id)"] : []),
    ...(filters.listId ? ["talent_list_members!inner(list_id)"] : []),
  ];
  let query = supabase
    .from("company_candidates")
    .select(
      `id, full_name, email, current_title, location, tags, created_at, source_batch_id, ${embeds.join(", ")}`,
      { count: "exact" },
    )
    .eq("company_id", companyId);

  const q = sanitizeSearchTerm(filters.q)?.toLowerCase();
  if (q) query = query.ilike("search_text", `%${q}%`);
  if (filters.loc) {
    const spellings = (await expandLocations([filters.loc])).map(sanitizeSearchTerm).filter(Boolean);
    if (spellings.length > 0) query = query.or(spellings.map((l) => `location.ilike.%${l}%`).join(","));
  }
  if (filters.resume === "has") query = query.not("resume_content", "is", null);
  if (filters.resume === "none") query = query.is("resume_content", null);
  if (filters.email === "has") query = query.not("email", "is", null);
  if (filters.email === "none") query = query.is("email", null);
  if (filters.addedDays) {
    query = query.gte("created_at", new Date(Date.now() - filters.addedDays * DAY_MS).toISOString());
  }
  if (filters.tag) query = query.contains("tags", [filters.tag]);
  if (filters.batchId) query = query.eq("source_batch_id", filters.batchId);
  if (filters.inJob === "no") query = query.is("in_job", null);
  if (filters.listId) query = query.eq("talent_list_members.list_id", filters.listId);
  if (similarityOf) query = query.in("id", [...similarityOf.keys()]);

  const from = (filters.page - 1) * CANDIDATES_PAGE_SIZE;
  // A match is sorted and paged here: the database can't order by similarity.
  const { data, error, count } = similarityOf
    ? await query
    : await query.order("created_at", { ascending: false }).range(from, from + CANDIDATES_PAGE_SIZE - 1);
  if (error) throw new Error(`Failed to load the candidates: ${error.message}`);

  type Row = {
    id: string;
    full_name: string;
    email: string | null;
    current_title: string | null;
    location: string | null;
    tags: string[];
    created_at: string;
    source_batch_id: string | null;
    candidate_import_batches: { file_name: string | null } | null;
    applications: { count: number }[];
  };
  let rows = (data ?? []) as unknown as Row[];
  if (similarityOf) {
    const sim = similarityOf;
    rows = [...rows]
      .sort((a, b) => (sim.get(b.id) ?? 0) - (sim.get(a.id) ?? 0) || b.created_at.localeCompare(a.created_at))
      .slice(from, from + CANDIDATES_PAGE_SIZE);
  }
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.full_name,
      email: row.email,
      title: row.current_title,
      location: row.location,
      tags: row.tags,
      batch: row.source_batch_id
        ? { id: row.source_batch_id, fileName: row.candidate_import_batches?.file_name ?? null }
        : null,
      jobCount: row.applications?.[0]?.count ?? 0,
      createdAt: row.created_at,
      score: similarityOf ? poolMatchScore(similarityOf.get(row.id) ?? 0) : null,
    })),
    total: similarityOf ? (count ?? (data ?? []).length) : (count ?? 0),
    page: filters.page,
    pageSize: CANDIDATES_PAGE_SIZE,
  };
}

/** The tag and import-file filters' options. Extra: an error gives none. */
export async function listCandidateFilterOptions(
  supabase: SupabaseClient<Database>,
  companyId: string,
): Promise<{ tags: string[]; batches: { id: string; fileName: string }[] }> {
  const [tagRows, batchRows] = await Promise.all([
    supabase.from("company_candidates").select("tags").eq("company_id", companyId).limit(5000),
    supabase
      .from("candidate_import_batches")
      .select("id, file_name")
      .eq("company_id", companyId)
      .eq("status", "confirmed")
      // A candidate added by hand gets a batch with no file.
      .not("file_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const tags = [...new Set((tagRows.data ?? []).flatMap((row) => row.tags))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  return {
    tags,
    batches: (batchRows.data ?? []).map((b) => ({ id: b.id, fileName: b.file_name ?? "" })),
  };
}
