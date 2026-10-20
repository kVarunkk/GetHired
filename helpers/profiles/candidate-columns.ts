import type { Database } from "@/utils/types/database.types";

/**
 * The `user_info` columns company users may read (RS-SEC-004). RLS works per
 * row, so code that serves company users selects these instead of `*`. Credits,
 * referral codes, promotion flags, embeddings and matching status stay out.
 * A literal string so Supabase can still infer the row type from it.
 */
export const RECRUITER_CANDIDATE_COLUMNS =
  "user_id, full_name, email, linkedin_url, github_url, desired_roles, preferred_locations, job_type, min_salary, max_salary, salary_currency, experience_years, industry_preferences, visa_sponsorship_required, top_skills, work_style_preferences, career_goals_short_term, career_goals_long_term, company_size_preference, filled, is_public, created_at, updated_at" as const;

type SplitColumns<S extends string> = S extends `${infer Head}, ${infer Tail}`
  ? Head | SplitColumns<Tail>
  : S;

export type RecruiterCandidateColumn = SplitColumns<typeof RECRUITER_CANDIDATE_COLUMNS>;

// Compile-time check: every listed column exists on user_info.
type UserInfoColumn = keyof Database["public"]["Tables"]["user_info"]["Row"];
const columnsExist: RecruiterCandidateColumn extends UserInfoColumn ? true : never = true;
void columnsExist;

export const recruiterCandidateColumnList = RECRUITER_CANDIDATE_COLUMNS.split(", ") as RecruiterCandidateColumn[];

/**
 * The directory profile (OR-REQ-010): what any company sees of a talent-pool
 * candidate, through `candidate_directory`. No email, LinkedIn, GitHub or
 * resume file; those come with access (applied, or answered Interested).
 */
export const DIRECTORY_CANDIDATE_COLUMNS =
  "user_id, full_name, desired_roles, preferred_locations, job_type, min_salary, max_salary, salary_currency, experience_years, industry_preferences, visa_sponsorship_required, top_skills, work_style_preferences, career_goals_short_term, career_goals_long_term, company_size_preference, filled, is_public, accepts_outreach, created_at, updated_at" as const;

export type DirectoryCandidateColumn = SplitColumns<typeof DIRECTORY_CANDIDATE_COLUMNS>;

// Compile-time check: every directory column is on the view and on user_info
// (internal service-role callers read user_info with the same list).
type DirectoryViewColumn = keyof Database["public"]["Views"]["candidate_directory"]["Row"];
const directoryColumnsExist: DirectoryCandidateColumn extends DirectoryViewColumn & UserInfoColumn
  ? true
  : never = true;
void directoryColumnsExist;

export const directoryCandidateColumnList = DIRECTORY_CANDIDATE_COLUMNS.split(", ") as DirectoryCandidateColumn[];
