/** Where applicants land by default after signing in or finishing a flow. */
export const APPLICANT_HOME = "/agent";
/** Where companies land by default. The middleware sends them to onboarding first if needed. */
export const COMPANY_HOME = "/company";

/**
 * The default landing page for a signed-in user, by role. Anyone who isn't a
 * company is treated as an applicant, as sign-up does.
 */
export function homePathFor(appMetadata: Record<string, unknown> | null | undefined) {
  return appMetadata?.type === "company" ? COMPANY_HOME : APPLICANT_HOME;
}

/**
 * `value` when it's a path on this site (e.g. a `returnTo` param), else null,
 * so a crafted link can't send someone off-site after they sign in.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  return value.startsWith("//") || value.startsWith("/\\") ? null : value;
}

/**
 * Company onboarding, carrying where to go once it's done (`returnTo`). The
 * dashboard is the default, so it isn't carried.
 */
export function companyOnboardingPath(returnTo?: string | null) {
  const path = safeReturnPath(returnTo);
  return path && path !== COMPANY_HOME
    ? `/get-started?company=true&returnTo=${encodeURIComponent(path)}`
    : "/get-started?company=true";
}
