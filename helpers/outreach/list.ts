import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { OutreachStatus } from "@/utils/types/outreach.types";
import { OUTREACH_PAGE_SIZE } from "./config";

type Client = SupabaseClient<Database>;

export type CompanyOutreachItem = {
  id: string;
  candidateUserId: string;
  candidateName: string | null;
  jobPostId: string | null;
  jobTitle: string | null;
  subject: string;
  status: OutreachStatus;
  source: "manual" | "agent";
  /** Who sent it, as stored at send time (teams difference 8); kept after they leave. */
  senderName: string | null;
  sentAt: string;
  respondedAt: string | null;
  expiresAt: string;
};

export type CompanyOutreachPage = {
  items: CompanyOutreachItem[];
  nextCursor: string | null;
  /** answered ÷ (sent − withdrawn) over the filter; null when nothing counts. */
  replyRate: number | null;
};

export type CompanyOutreachFilter = {
  jobPostId?: string | null;
  status?: OutreachStatus | null;
  cursor?: string | null;
};

const ANSWERED: OutreachStatus[] = ["interested", "not_interested", "reported"];

/** `sent_at|id` of the last row on a page. */
export function encodeCursor(sentAt: string, id: string) {
  return `${sentAt}|${id}`;
}

export function decodeCursor(cursor: string | null | undefined): { sentAt: string; id: string } | null {
  if (!cursor) return null;
  const [sentAt, id] = cursor.split("|");
  if (!sentAt || !id || Number.isNaN(Date.parse(sentAt)) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { sentAt, id };
}

/**
 * Display names for candidates the company contacted. Talent-pool candidates
 * come from `candidate_directory`; applicants and interested candidates (who
 * may be private) from `user_info`, which RLS opens for them.
 */
export async function loadCandidateNames(supabase: Client, ids: string[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return names;

  const { data: directory } = await supabase
    .from("candidate_directory")
    .select("user_id, full_name")
    .in("user_id", unique);
  for (const row of directory ?? []) if (row.user_id) names.set(row.user_id, row.full_name);

  const missing = unique.filter((id) => !names.has(id));
  if (missing.length > 0) {
    const { data: full } = await supabase.from("user_info").select("user_id, full_name").in("user_id", missing);
    for (const row of full ?? []) names.set(row.user_id, row.full_name);
  }
  return names;
}

/**
 * The company's outreach, newest first, 25 a page (OR-REQ-007). Scoped to the
 * session company by the filter and by RLS.
 */
export async function listCompanyOutreach(
  { supabase, company }: { supabase: Client; company: { id: string } },
  { jobPostId, status, cursor }: CompanyOutreachFilter = {},
): Promise<CompanyOutreachPage> {
  const filtered = <Q extends { eq: (column: string, value: string) => Q }>(q: Q): Q => {
    let next = q.eq("company_id", company.id);
    if (jobPostId) next = next.eq("job_post_id", jobPostId);
    return next;
  };

  let query = filtered(
    supabase
      .from("candidate_outreach")
      .select(
        "id, candidate_user_id, job_post_id, subject, status, source, sender_name, sent_at, responded_at, expires_at, job_postings(title)",
      ),
  );
  if (status) query = query.eq("status", status);
  const after = decodeCursor(cursor);
  if (after) {
    query = query.or(`sent_at.lt.${after.sentAt},and(sent_at.eq.${after.sentAt},id.lt.${after.id})`);
  }

  const count = (apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => apply(base());
  const base = () => filtered(supabase.from("candidate_outreach").select("id", { count: "exact", head: true }));

  const [{ data, error }, total, withdrawn, answered] = await Promise.all([
    query.order("sent_at", { ascending: false }).order("id", { ascending: false }).limit(OUTREACH_PAGE_SIZE + 1),
    count((q) => q),
    count((q) => q.eq("status", "withdrawn")),
    count((q) => q.in("status", ANSWERED)),
  ]);
  if (error) throw new Error(`Failed to load outreach: ${error.message}`);

  const rows = data ?? [];
  const page = rows.slice(0, OUTREACH_PAGE_SIZE);
  const names = await loadCandidateNames(
    supabase,
    page.map((r) => r.candidate_user_id),
  );

  const denominator = (total.count ?? 0) - (withdrawn.count ?? 0);
  const last = page[page.length - 1];

  return {
    items: page.map((r) => ({
      id: r.id,
      candidateUserId: r.candidate_user_id,
      candidateName: names.get(r.candidate_user_id) ?? null,
      jobPostId: r.job_post_id,
      jobTitle: r.job_postings?.title ?? null,
      subject: r.subject,
      status: r.status as OutreachStatus,
      source: r.source as "manual" | "agent",
      senderName: r.sender_name,
      sentAt: r.sent_at,
      respondedAt: r.responded_at,
      expiresAt: r.expires_at,
    })),
    nextCursor: rows.length > OUTREACH_PAGE_SIZE && last ? encodeCursor(last.sent_at, last.id) : null,
    replyRate: denominator > 0 ? (answered.count ?? 0) / denominator : null,
  };
}

export type OutreachBadge = { id: string; status: OutreachStatus; sentAt: string };

/** The company's newest outreach per candidate, for badges on cards and the profile page. */
export async function outreachStatusFor(
  { supabase, company }: { supabase: Client; company: { id: string } },
  candidateIds: string[],
): Promise<Record<string, OutreachBadge>> {
  const ids = [...new Set(candidateIds)];
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from("candidate_outreach")
    .select("id, candidate_user_id, status, sent_at")
    .eq("company_id", company.id)
    .in("candidate_user_id", ids)
    .order("sent_at", { ascending: false });
  if (error) throw new Error(`Failed to load outreach status: ${error.message}`);

  const result: Record<string, OutreachBadge> = {};
  for (const row of data ?? []) {
    if (result[row.candidate_user_id]) continue;
    result[row.candidate_user_id] = { id: row.id, status: row.status as OutreachStatus, sentAt: row.sent_at };
  }
  return result;
}

export type Opportunity = {
  id: string;
  companyId: string;
  companyName: string | null;
  companyLogo: string | null;
  jobPostId: string | null;
  jobTitle: string | null;
  subject: string;
  status: OutreachStatus;
  sentAt: string;
  respondedAt: string | null;
  expiresAt: string;
};

/** True while the candidate can still answer. */
export function isOpen(o: { status: OutreachStatus; expiresAt: string }, now = Date.now()) {
  return o.status === "sent" && Date.parse(o.expiresAt) > now;
}

/** The candidate's outreach (OR-REQ-003): open first, then the rest, newest first in each group. */
export async function listMyOpportunities(supabase: Client, userId: string): Promise<Opportunity[]> {
  const { data, error } = await supabase
    .from("candidate_outreach")
    .select(
      "id, company_id, job_post_id, subject, status, sent_at, responded_at, expires_at, company_info(name, logo_url), job_postings(title)",
    )
    .eq("candidate_user_id", userId)
    .order("sent_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Failed to load opportunities: ${error.message}`);

  const items: Opportunity[] = (data ?? []).map((r) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: r.company_info?.name ?? null,
    companyLogo: r.company_info?.logo_url ?? null,
    jobPostId: r.job_post_id,
    jobTitle: r.job_postings?.title ?? null,
    subject: r.subject,
    status: r.status as OutreachStatus,
    sentAt: r.sent_at,
    respondedAt: r.responded_at,
    expiresAt: r.expires_at,
  }));

  const now = Date.now();
  return [...items.filter((o) => isOpen(o, now)), ...items.filter((o) => !isOpen(o, now))];
}
