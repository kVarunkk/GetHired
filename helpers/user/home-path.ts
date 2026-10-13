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
