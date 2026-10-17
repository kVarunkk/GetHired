import type { Database } from "@/utils/types/database.types";
import type { ResumeSectionsPublic } from "@/utils/types/outreach.types";
import { COMPANY_A, PUBLIC_APPLICANT, jobPostingOf } from "./recruiter";

type Tables = Database["public"]["Tables"];

export type OutreachStatus =
  | "sent"
  | "interested"
  | "not_interested"
  | "expired"
  | "withdrawn"
  | "reported";

export type CandidateOutreachRow = Tables["candidate_outreach"]["Row"];
export type CandidateCompanyBlockRow = Tables["candidate_company_blocks"]["Row"];

export type AttachmentKind = "interview_session" | "resume_review";

export type ApplicationAttachmentRow = {
  id: string;
  application_id: string;
  kind: AttachmentKind;
  interview_session_id: string | null;
  resume_review_id: string | null;
  first_viewed_at: string | null;
  created_at: string;
};

/** A `candidate_directory` row: only the OR-REQ-010 columns plus `resume_sections`. */
export type DirectoryRow = Omit<
  Database["public"]["Views"]["candidate_directory"]["Row"],
  | "resume_sections"
  | "desired_roles_search"
  | "top_skills_search"
  | "work_style_preferences_search"
  | "industry_preferences_search"
> & {
  resume_sections: ResumeSectionsPublic;
};

const SENT_AT = "2026-10-01T09:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;

let seq = 0;
const seqId = (prefix: string, n: number) =>
  `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/** A posting of COMPANY_A that outreach fixtures point at. */
export const OUTREACH_JOB = jobPostingOf(COMPANY_A, { title: "Frontend Engineer", status: "active" });

/** A `candidate_outreach` row from COMPANY_A to PUBLIC_APPLICANT, expiring 30 days after `sent_at`. */
export function outreachOf(
  status: OutreachStatus = "sent",
  overrides: Partial<CandidateOutreachRow> = {},
): CandidateOutreachRow {
  seq += 1;
  const sentAt = overrides.sent_at ?? SENT_AT;
  const answered = status === "interested" || status === "not_interested" || status === "reported";
  return {
    id: seqId("f0000000", seq),
    company_id: COMPANY_A.id,
    candidate_user_id: PUBLIC_APPLICANT.id,
    job_post_id: OUTREACH_JOB.id,
    sender_user_id: COMPANY_A.user.id,
    sender_name: "Olive Owner",
    subject: "Frontend role at Acme",
    message: "Hi Ada, your React work stood out. Open to a chat about our frontend role?",
    status,
    decline_reason: null,
    candidate_note: null,
    candidate_contact: null,
    source: "manual",
    sent_at: sentAt,
    responded_at: answered ? new Date(Date.parse(sentAt) + DAY).toISOString() : null,
    expires_at: new Date(Date.parse(sentAt) + 30 * DAY).toISOString(),
    ...overrides,
  };
}

export function blockOf(overrides: Partial<CandidateCompanyBlockRow> = {}): CandidateCompanyBlockRow {
  return {
    candidate_user_id: PUBLIC_APPLICANT.id,
    company_id: COMPANY_A.id,
    created_at: SENT_AT,
    ...overrides,
  };
}

export function attachmentOf(
  kind: AttachmentKind,
  overrides: Partial<ApplicationAttachmentRow> = {},
): ApplicationAttachmentRow {
  seq += 1;
  return {
    id: seqId("a7000000", seq),
    application_id: seqId("e0000000", 1),
    kind,
    interview_session_id: kind === "interview_session" ? seqId("15000000", seq) : null,
    resume_review_id: kind === "resume_review" ? seqId("2e000000", seq) : null,
    first_viewed_at: null,
    created_at: SENT_AT,
    ...overrides,
  };
}

/** PUBLIC_APPLICANT as `candidate_directory` returns them: no contact columns. */
export function directoryRowOf(overrides: Partial<DirectoryRow> = {}): DirectoryRow {
  const i = PUBLIC_APPLICANT.info;
  return {
    user_id: i.user_id,
    full_name: i.full_name,
    desired_roles: i.desired_roles,
    preferred_locations: i.preferred_locations,
    job_type: i.job_type,
    min_salary: i.min_salary,
    max_salary: i.max_salary,
    salary_currency: i.salary_currency,
    experience_years: i.experience_years,
    industry_preferences: i.industry_preferences,
    visa_sponsorship_required: i.visa_sponsorship_required,
    top_skills: i.top_skills,
    work_style_preferences: i.work_style_preferences,
    career_goals_short_term: i.career_goals_short_term,
    career_goals_long_term: i.career_goals_long_term,
    company_size_preference: i.company_size_preference,
    filled: i.filled,
    is_public: i.is_public,
    accepts_outreach: true,
    created_at: i.created_at,
    updated_at: i.updated_at,
    resume_sections: [
      {
        type: "experience",
        items: [
          {
            heading: "Software Engineer",
            subheading: "Analytical Engines, 2020–2024",
            bullets: [{ text: "Built the React design system used by 4 teams." }],
          },
        ],
      },
      { type: "skills", items: [{ bullets: [{ text: "React, TypeScript" }] }] },
    ],
    ...overrides,
  };
}

/** A valid send input for PUBLIC_APPLICANT about OUTREACH_JOB. */
export const OUTREACH_INPUT = {
  candidateId: PUBLIC_APPLICANT.id,
  jobPostId: OUTREACH_JOB.id,
  subject: "Frontend role at Acme",
  message: "Hi Ada, your React work stood out. Open to a chat about our frontend role?",
};

/** Columns that reveal how to reach a candidate outside GetHired. */
export const CONTACT_COLUMNS = ["email", "linkedin_url", "github_url", "resume_path"] as const;
