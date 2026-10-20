import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { DeclineReason, OutreachSource, OutreachStatus } from "@/utils/types/outreach.types";
import { loadCandidateNames } from "./list";

type Client = SupabaseClient<Database>;

export type CompanyOutreachDetail = {
  id: string;
  candidateUserId: string;
  candidateName: string | null;
  jobPostId: string | null;
  jobTitle: string | null;
  subject: string;
  message: string;
  status: OutreachStatus;
  source: OutreachSource;
  senderName: string | null;
  sentAt: string;
  respondedAt: string | null;
  expiresAt: string;
  declineReason: DeclineReason | null;
  /** The candidate's note with an Interested answer. A report's note goes to GetHired, not the company. */
  candidateNote: string | null;
  /** How to reach them, given only with an Interested answer. */
  candidateContact: string | null;
};

/**
 * One of the company's outreach messages with the candidate's answer. Scoped
 * to the session company by the filter and by RLS; null when it isn't theirs.
 */
export async function getCompanyOutreach(
  { supabase, company }: { supabase: Client; company: { id: string } },
  id: string,
): Promise<CompanyOutreachDetail | null> {
  const { data: row, error } = await supabase
    .from("candidate_outreach")
    .select(
      "id, candidate_user_id, job_post_id, subject, message, status, source, sender_name, sent_at, responded_at, expires_at, decline_reason, candidate_note, candidate_contact, job_postings(title)",
    )
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load outreach: ${error.message}`);
  if (!row) return null;

  const names = await loadCandidateNames(supabase, [row.candidate_user_id]);
  const status = row.status as OutreachStatus;
  const interested = status === "interested";

  return {
    id: row.id,
    candidateUserId: row.candidate_user_id,
    candidateName: names.get(row.candidate_user_id) ?? null,
    jobPostId: row.job_post_id,
    jobTitle: row.job_postings?.title ?? null,
    subject: row.subject,
    message: row.message,
    status,
    source: row.source as OutreachSource,
    senderName: row.sender_name,
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
    expiresAt: row.expires_at,
    declineReason: status === "not_interested" ? ((row.decline_reason as DeclineReason | null) ?? null) : null,
    candidateNote: interested ? row.candidate_note : null,
    candidateContact: interested ? row.candidate_contact : null,
  };
}
