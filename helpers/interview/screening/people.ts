import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

type PersonRef = { applicant_user_id: string | null; company_candidate_id?: string | null };

export type InterviewPerson = {
  /** Null when there's none, or a company candidate unsubscribed (BI-REQ-034). */
  email: string | null;
  fullName: string | null;
  /** Set for an imported applicant who hasn't claimed the interview yet (BI-REQ-040). */
  candidateId: string | null;
};

/**
 * The people behind screening interviews, for the cron and notification
 * emails: the applicant's user_info, or, before a claim, the company
 * candidate the interview was created for. Returns a lookup by interview.
 */
export async function interviewPeople(
  admin: SupabaseClient<Database>,
  rows: PersonRef[],
): Promise<(row: PersonRef) => InterviewPerson | null> {
  const userIds = [...new Set(rows.flatMap((r) => (r.applicant_user_id ? [r.applicant_user_id] : [])))];
  const candidateIds = [
    ...new Set(rows.flatMap((r) => (!r.applicant_user_id && r.company_candidate_id ? [r.company_candidate_id] : []))),
  ];
  const [{ data: users }, { data: candidates }] = await Promise.all([
    userIds.length > 0
      ? admin.from("user_info").select("user_id, email, full_name").in("user_id", userIds)
      : Promise.resolve({ data: [] }),
    candidateIds.length > 0
      ? admin.from("company_candidates").select("id, email, full_name, email_opted_out_at").in("id", candidateIds)
      : Promise.resolve({ data: [] }),
  ]);
  const userOf = new Map((users ?? []).map((u) => [u.user_id, u]));
  const candidateOf = new Map((candidates ?? []).map((c) => [c.id, c]));

  return (row) => {
    if (row.applicant_user_id) {
      const user = userOf.get(row.applicant_user_id);
      return user ? { email: user.email, fullName: user.full_name, candidateId: null } : null;
    }
    const candidate = row.company_candidate_id ? candidateOf.get(row.company_candidate_id) : undefined;
    if (!candidate) return null;
    return {
      email: candidate.email_opted_out_at ? null : candidate.email,
      fullName: candidate.full_name,
      candidateId: candidate.id,
    };
  };
}
