/** Links for job alerts. Client-safe. */

/** The Settings section (JA-REQ-040). */
export const JOB_ALERTS_SETTINGS_PATH = "/settings#job-alerts";

/** The URL param a logged-out "Create alert" carries through sign-up (JA-REQ-018). */
export const CREATE_ALERT_PARAM = "createAlert";

/** Email job links carry `ref=job_alert` (not `src=`, which is a distribution channel; JA-REQ-037). */
export const JOB_ALERT_REF = "job_alert";

/** A job's page, from an alert email. */
export function jobAlertJobUrl(baseUrl: string, jobId: string, alertId: string): string {
  const params = new URLSearchParams({ ref: JOB_ALERT_REF, aid: alertId });
  return `${baseUrl}/jobs/${encodeURIComponent(jobId)}?${params.toString()}`;
}

/** The alert's search, from an alert email ("See all"). `path` is the stored `bookmarks.url`. */
export function jobAlertSearchUrl(baseUrl: string, path: string, alertId: string): string {
  const separator = path.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ ref: JOB_ALERT_REF, aid: alertId });
  return `${baseUrl}${path}${separator}${params.toString()}`;
}

/**
 * The sign-up link for a logged-out "Create alert": back to this search with
 * `createAlert` set, which /jobs consumes once after onboarding.
 */
export function createAlertSignupHref(search: string, frequency: "daily" | "weekly"): string {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  params.delete(CREATE_ALERT_PARAM);
  params.set(CREATE_ALERT_PARAM, frequency);
  const returnTo = `/jobs?${params.toString()}`;
  return `/auth/sign-up?returnTo=${encodeURIComponent(returnTo)}`;
}
