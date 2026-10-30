// BI-REQ-030: who an application is from, whether a GetHired applicant
// (`user_info`) or one of the company's own candidates (`company_candidates`),
// so pages don't branch on the two joins. Client-safe.

/** The embed the company readers add to their `applications` select. */
export const COMPANY_CANDIDATE_PERSON_COLUMNS = "company_candidates(id, full_name, email, resume_path)";

export type ApplicationPersonRow = {
  applicant_user_id: string | null;
  company_candidate_id?: string | null;
  user_info?: { full_name?: string | null; email?: string | null } | null;
  company_candidates?: {
    id: string;
    full_name: string;
    email?: string | null;
    resume_path?: string | null;
    resume_content?: unknown;
  } | null;
};

export type ApplicationPerson = {
  kind: "user" | "candidate";
  id: string;
  name: string;
  email?: string;
  /** Their profile page: the talent profile or the candidate page. */
  href: string;
  /** Came in through an import (claimed or not): shows the "Imported" badge. */
  imported: boolean;
  /** False for a company candidate with no resume, which explains a missing score. */
  hasResume: boolean;
  /** A claimed candidate's GetHired account: shows the "GetHired account connected" badge. */
  connectedUserId?: string;
};

/**
 * The company's own record wins whenever there is one (BI-REQ-043): a claim
 * connects a GetHired account to it, the way an ATS connects a profile, and
 * never replaces it. A claimed candidate (both ids set) reads as the
 * candidate, with `connectedUserId` for the account.
 */
export function applicationPerson(row: ApplicationPersonRow): ApplicationPerson {
  if (row.company_candidate_id) {
    const candidate = row.company_candidates;
    return {
      kind: "candidate",
      id: row.company_candidate_id,
      name: candidate?.full_name?.trim() || row.user_info?.full_name?.trim() || "Candidate",
      ...(candidate?.email ? { email: candidate.email } : {}),
      href: `/company/candidates/${row.company_candidate_id}`,
      imported: true,
      hasResume: Boolean(candidate?.resume_path || candidate?.resume_content),
      ...(row.applicant_user_id ? { connectedUserId: row.applicant_user_id } : {}),
    };
  }
  if (row.applicant_user_id) {
    return {
      kind: "user",
      id: row.applicant_user_id,
      name: row.user_info?.full_name?.trim() || "Applicant",
      ...(row.user_info?.email ? { email: row.user_info.email } : {}),
      href: `/company/profiles/${row.applicant_user_id}`,
      imported: false,
      hasResume: true,
    };
  }
  throw new Error("An application needs an applicant or a company candidate.");
}

/** `applicationPerson`, or null for a row the reader couldn't fully load (no id at all). */
export function applicationPersonOrNull(row: ApplicationPersonRow): ApplicationPerson | null {
  return row.applicant_user_id || row.company_candidate_id ? applicationPerson(row) : null;
}
