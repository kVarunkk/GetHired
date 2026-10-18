import type { ApplicationForm } from "@/helpers/jobs/application-form-schema";
import { standardAnswerKey, type Answers } from "./validate-answers";

/** The profile values the applicant form can prefill from (`/api/current-user`). */
export type PrefillProfile = {
  linkedin_url?: string | null;
  github_url?: string | null;
  preferred_locations?: string[] | null;
  min_salary?: number | null;
  salary_currency?: string | null;
};

/**
 * AF-REQ-002: standard-field values taken from the applicant's profile, only
 * for fields the job asks for. The applicant can change them before sending.
 */
export function prefillStandardAnswers(form: ApplicationForm, profile: PrefillProfile | null): Answers {
  if (!profile) return {};
  const asks = (key: keyof ApplicationForm["standard_fields"]) => {
    const mode = form.standard_fields[key];
    return mode === "optional" || mode === "required";
  };
  const out: Answers = {};
  if (asks("linkedin_url") && profile.linkedin_url) out[standardAnswerKey("linkedin_url")] = profile.linkedin_url;
  if (asks("portfolio_url") && profile.github_url) out[standardAnswerKey("portfolio_url")] = profile.github_url;
  const location = profile.preferred_locations?.find((l) => l.trim() !== "");
  if (asks("current_location") && location) out[standardAnswerKey("current_location")] = location;
  const currency = profile.salary_currency?.trim().toUpperCase();
  if (asks("expected_salary") && typeof profile.min_salary === "number" && currency && /^[A-Z]{3}$/.test(currency)) {
    out[standardAnswerKey("expected_salary")] = { amount: profile.min_salary, currency };
  }
  return out;
}
