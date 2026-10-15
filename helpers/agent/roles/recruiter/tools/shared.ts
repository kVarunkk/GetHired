import { z } from "zod";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { screenFairnessText, scrubPII, type FairnessContext } from "@/helpers/ai/fairness";
import { wrapInSandbox } from "@/helpers/ai/security";
import { extractSectionText } from "@/utils/extract-resume-content";
import type { TResumeRowContent } from "@/utils/types";
import { entitlementMessage, type EntitlementPayload } from "@/helpers/billing/errors";
import type { AgentToolContext } from "@/helpers/agent/tools/shared";
import { RA_RESUME_EXCERPT_MAX_CHARS, RA_UPGRADE_URL } from "../config";

export { limitInput, uuidInput, withToolErrors } from "@/helpers/agent/tools/shared";

/**
 * What every recruiter tool closes over. The company comes from the session
 * (`requireAgentUser`), never from model input (RA-SEC-002).
 */
export type RecruiterToolContext = AgentToolContext & { company: MyCompany };

/**
 * The `user_info` columns recruiter tools read about candidates. No email,
 * phone or profile links: the agent never outputs contact details before the
 * outreach spec's access check exists (RA-SEC-005).
 */
export const AGENT_CANDIDATE_COLUMNS =
  "user_id, full_name, desired_roles, preferred_locations, experience_years, top_skills, min_salary, max_salary, salary_currency, work_style_preferences, job_type" as const;

export type CandidateRow = {
  user_id: string;
  full_name?: string | null;
  desired_roles?: string[] | null;
  preferred_locations?: string[] | null;
  experience_years?: number | null;
  top_skills?: string[] | null;
  min_salary?: number | null;
  max_salary?: number | null;
  salary_currency?: string | null;
  work_style_preferences?: string[] | null;
  job_type?: string[] | null;
};

export const candidateUrl = (candidateId: string, jobPostId?: string | null) =>
  `/company/profiles/${candidateId}${jobPostId ? `?job_post=${jobPostId}` : ""}`;
export const applicationUrl = (applicationId: string) => `/company/applicants/${applicationId}`;
export const jobPostUrl = (jobPostId: string) => `/company/job-posts/${jobPostId}`;

export function formatSalary(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined,
) {
  const c = currency ?? "";
  if (min && max) return `${c}${min}–${c}${max}`;
  if (min) return `${c}${min}+`;
  if (max) return `up to ${c}${max}`;
  return null;
}

/** The candidate fields the model needs (RA-GUD-001). Never contact details. */
export function compactCandidate(row: CandidateRow, { jobPostId }: { jobPostId?: string | null } = {}) {
  return {
    id: row.user_id,
    name: row.full_name ?? null,
    roles: (row.desired_roles ?? []).slice(0, 3),
    experienceYears: row.experience_years ?? null,
    locations: (row.preferred_locations ?? []).slice(0, 3),
    topSkills: (row.top_skills ?? []).slice(0, 6),
    salary: formatSalary(row.min_salary, row.max_salary, row.salary_currency),
    workStyle: (row.work_style_preferences ?? []).slice(0, 3),
    url: candidateUrl(row.user_id, jobPostId),
  };
}

export type CompactCandidate = ReturnType<typeof compactCandidate>;

/** A plan limit or allowance ran out (BL-REQ-020), in the agent's error shape. */
export function planLimitError(payload: EntitlementPayload & { message?: string }) {
  return {
    error: "PLAN_LIMIT",
    message: payload.message ?? entitlementMessage(payload),
    upgradeUrl: RA_UPGRADE_URL,
  } as const;
}

/**
 * The first text that names a protected characteristic, as a
 * `NOT_JOB_RELATED` error the model must explain (RA-SEC-004), or null.
 */
export function fairnessError(
  values: (string | null | undefined)[],
  context: FairnessContext = "candidate_filter",
) {
  for (const value of values) {
    if (!value) continue;
    const result = screenFairnessText(value, { context });
    if (!result.ok) {
      return {
        error: "NOT_JOB_RELATED",
        message: `Candidates can't be searched, ranked or described by ${result.term}. Use job-related criteria instead.`,
      } as const;
    }
  }
  return null;
}

/** A short free-text list input (roles, skills, locations). */
export const textListInput = (what: string, max: number) =>
  z.array(z.string().trim().min(1).max(100)).max(max).optional().describe(what);

/**
 * The parts of a resume worth reading for fit, with contact details scrubbed
 * (RA-SEC-005), trimmed and sandboxed (RA-SEC-003). Education is left out:
 * graduation years are an age proxy (RA-SEC-004).
 */
export function resumeExcerpt(content: TResumeRowContent | null | undefined) {
  if (!content?.sections?.length) return null;
  const { experience, skills, projects } = extractSectionText(
    ["experience", "skills", "projects"],
    content,
  );
  const text = [
    experience && `Experience:\n${experience}`,
    skills && `Skills:\n${skills}`,
    projects && `Projects:\n${projects}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!text) return null;
  return wrapInSandbox("resume_excerpt", scrubPII(text).slice(0, RA_RESUME_EXCERPT_MAX_CHARS));
}
