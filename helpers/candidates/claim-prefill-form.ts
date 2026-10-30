// BIT-105: the claim prefill as the onboarding form uses it. Client-safe.

export type ClaimPrefillFields = {
  full_name: string;
  desired_roles: string[];
  preferred_locations: string[];
  experience_years: number | null;
  top_skills: string[];
  linkedin_url: string | null;
  github_url: string | null;
};

export type ClaimPrefill = {
  companyName: string;
  fields: ClaimPrefillFields;
  /** Only a PDF: applicant resumes are PDFs. */
  resume: { name: string } | null;
};

/** What the onboarding form gets: the prefill and the claim link it came from. */
export type OnboardingClaimPrefill = ClaimPrefill & { token: string };

type PrefillTarget = {
  full_name: string;
  desired_roles: string[];
  preferred_locations: string[];
  experience_years: number | "";
  top_skills: string[];
  linkedin_url: string;
  github_url: string;
};

/**
 * The form's values with the claim's fields filled in where the person has
 * nothing yet. What they already have is never replaced.
 */
export function fillEmptyFromClaim<T extends PrefillTarget>(form: T, fields: ClaimPrefillFields): T {
  const text = (current: string, value: string | null) => (current.trim() ? current : (value ?? ""));
  const list = (current: string[], value: string[]) => (current.length > 0 ? current : value);
  return {
    ...form,
    full_name: text(form.full_name, fields.full_name),
    desired_roles: list(form.desired_roles, fields.desired_roles),
    preferred_locations: list(form.preferred_locations, fields.preferred_locations),
    experience_years: form.experience_years === "" ? (fields.experience_years ?? "") : form.experience_years,
    top_skills: list(form.top_skills, fields.top_skills),
    linkedin_url: text(form.linkedin_url, fields.linkedin_url),
    github_url: text(form.github_url, fields.github_url),
  };
}
