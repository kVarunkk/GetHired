import type { User } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { mockUser } from "./auth";

type Tables = Database["public"]["Tables"];
type CompanyInfoRow = Tables["company_info"]["Row"];
type CompanyTierRow = Tables["company_tiers"]["Row"];
type UserInfoRow = Tables["user_info"]["Row"];
type JobPostingRow = Tables["job_postings"]["Row"];
type ApplicationRow = Tables["applications"]["Row"];

const CREATED_AT = "2026-01-01T00:00:00.000Z";

/** RS-SEC-004: user_info columns never returned to company users (plus any embedding). */
export const FORBIDDEN_CANDIDATE_COLUMNS = [
  "ai_credits",
  "referral_code",
  "invitations_count",
  "is_promotion_active",
  "is_job_digest_active",
  "last_promo_version_seen",
  "relevant_jobs_update_status",
  "matched_at",
  "embedding_new",
  "embedding_updated_at",
];

export const FREE_TIER: CompanyTierRow = {
  id: "7e000000-0000-4000-8000-000000000001",
  name: "Free",
  slug: "free",
  is_public: true,
  sort: 0,
  description: null,
  features: [],
  prices: [],
  price_plan_id: null,
  created_at: CREATED_AT,
  updated_at: null,
};

export type CompanyFixture = {
  id: string;
  /** The company's owner, as the session user. */
  user: User;
  info: CompanyInfoRow;
  tier: CompanyTierRow;
  /** `company_info` with the `company_tiers` join, as `getMyCompany` selects it. */
  infoWithTier: CompanyInfoRow & { company_tiers: CompanyTierRow };
};

function company(n: number, name: string): CompanyFixture {
  const id = `c0000000-0000-4000-8000-00000000000${n}`;
  const userId = `c1000000-0000-4000-8000-00000000000${n}`;
  const email = `hr@${name.toLowerCase()}.dev`;
  const info: CompanyInfoRow = {
    id,
    user_id: userId,
    name,
    email,
    tier_id: FREE_TIER.id,
    ai_credits: 0,
    job_posts_created: 0,
    company_size: null,
    description: null,
    embedding: null,
    embedding_new: null,
    embedding_updated_at: null,
    filled: true,
    headquarters: null,
    industry: null,
    is_relevant_profiles_generated: false,
    logo_url: null,
    tag_line: null,
    website: `https://${name.toLowerCase()}.dev`,
    scheduling_url: null,
    default_role_id: `f3000000-0000-4000-8000-00000000000${n}`,
    notify_new_applicants: "daily",
    notify_weekly_matches: true,
    last_applicant_digest_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
  return {
    id,
    user: mockUser({ type: "company", id: userId, email }),
    info,
    tier: FREE_TIER,
    infoWithTier: { ...info, company_tiers: FREE_TIER },
  };
}

export const COMPANY_A = company(1, "Acme");
export const COMPANY_B = company(2, "Globex");

export type ApplicantFixture = { id: string; user: User; info: UserInfoRow };

function applicant(n: number, name: string, isPublic: boolean): ApplicantFixture {
  const id = `a0000000-0000-4000-8000-00000000000${n}`;
  const email = `${name.split(" ")[0].toLowerCase()}@example.com`;
  return {
    id,
    user: mockUser({ type: "applicant", id, email }),
    info: {
      user_id: id,
      email,
      full_name: name,
      is_public: isPublic,
      filled: true,
      desired_roles: ["Frontend Engineer"],
      top_skills: ["React", "TypeScript"],
      experience_years: 4,
      preferred_locations: ["bengaluru"],
      job_type: ["Fulltime"],
      salary_currency: "₹",
      min_salary: 1500000,
      max_salary: 2500000,
      work_style_preferences: ["Remote"],
      company_size_preference: null,
      industry_preferences: null,
      career_goals_long_term: null,
      career_goals_short_term: null,
      visa_sponsorship_required: false,
      github_url: null,
      linkedin_url: null,
      accepts_outreach: true,
      desired_roles_search: null,
      industry_preferences_search: null,
      top_skills_search: null,
      work_style_preferences_search: null,
      // Sensitive columns, set to recognisable values so leaks are visible.
      ai_credits: 4242,
      referral_code: `REF-${n}-SECRET`,
      invitations_count: 7,
      is_promotion_active: true,
      is_job_digest_active: true,
      last_promo_version_seen: "v9",
      embedding_new: "[0.1,0.2,0.3]",
      embedding_updated_at: CREATED_AT,
      relevant_jobs_update_status: "completed",
      matched_at: CREATED_AT,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    },
  };
}

export const PUBLIC_APPLICANT = applicant(1, "Ada Lovelace", true);
/** Private, but has applied to one of COMPANY_A's postings. */
export const PRIVATE_APPLIED_TO_A = applicant(2, "Grace Hopper", false);
/** Private and hasn't applied anywhere: no company may see them. */
export const PRIVATE_NOT_APPLIED = applicant(3, "Alan Turing", false);

let postingSeq = 0;
let applicationSeq = 0;

const seqId = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export function jobPostingOf(
  owner: CompanyFixture,
  overrides: Partial<JobPostingRow> = {},
): JobPostingRow {
  postingSeq += 1;
  return {
    id: seqId("b0000000", postingSeq),
    job_id: seqId("d0000000", postingSeq),
    company_id: owner.id,
    title: "Frontend Engineer",
    description: "Build the product UI with React and TypeScript.",
    location: ["bengaluru"],
    job_type: "Fulltime",
    salary_currency: "₹",
    min_salary: 1500000,
    max_salary: 2500000,
    salary_range: null,
    min_experience: 2,
    max_experience: 5,
    experience: null,
    min_equity: null,
    max_equity: null,
    equity_range: null,
    visa_sponsorship: "Not Required",
    questions: [],
    skills: ["React"],
    status: "inactive",
    matching_status: "pending",
    matching_error: null,
    matched_at: null,
    last_applicant_notified_at: null,
    embedding: null,
    embedding_new: null,
    embedding_updated_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

export function applicationOf(
  candidate: ApplicantFixture,
  posting: JobPostingRow,
  overrides: Partial<ApplicationRow> = {},
): ApplicationRow {
  applicationSeq += 1;
  return {
    id: seqId("e0000000", applicationSeq),
    applicant_user_id: candidate.id,
    job_post_id: posting.id,
    all_jobs_id: posting.job_id,
    answers: [],
    resume_id: null,
    resume_path: null,
    resume_url: null,
    source: "applied",
    stage_entered_at: CREATED_AT,
    stage_id: null,
    status: "submitted",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}
