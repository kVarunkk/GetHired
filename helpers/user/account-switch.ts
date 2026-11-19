/**
 * Candidate and company accounts are separate logins, so moving between them
 * means signing out first. Client-safe.
 */
export type AccountKind = "company" | "applicant";

export const COMPANY_SIGN_UP_PATH = "/auth/sign-up?company=true";
export const COMPANY_LOGIN_PATH = "/auth/login?company=true";
export const APPLICANT_SIGN_UP_PATH = "/auth/sign-up";
export const APPLICANT_LOGIN_PATH = "/auth/login";

/** Where a signed-in applicant goes when they try to start hiring. */
export const SWITCH_TO_COMPANY_PATH = "/switch-to-company";
/** Where a signed-in company user goes when they try to look for a job. */
export const SWITCH_TO_APPLICANT_PATH = "/switch-to-applicant";

export const SWITCH_TARGETS: Record<AccountKind, { signUp: string; login: string }> = {
  company: { signUp: COMPANY_SIGN_UP_PATH, login: COMPANY_LOGIN_PATH },
  applicant: { signUp: APPLICANT_SIGN_UP_PATH, login: APPLICANT_LOGIN_PATH },
};
