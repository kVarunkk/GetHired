import type { JobAlertRow } from "@/helpers/job-alerts/alerts";

/** A fixed "now" for job alert tests: Monday 2026-11-23 03:30 UTC (weekly alerts are due). */
export const ALERT_NOW = new Date("2026-11-23T03:30:00Z");

export const ALERT_USER_ID = "00000000-0000-4000-8000-000000000001";
export const ALERT_ID = "a1e00000-0000-4000-8000-000000000001";

/** A `bookmarks` row with the job alert columns. */
export function alertRow(overrides: Partial<JobAlertRow> = {}): JobAlertRow {
  return {
    id: ALERT_ID,
    name: "Frontend jobs in Pune",
    url: "/jobs?jobTitleKeywords=frontend&location=pune",
    filters: { jobTitleKeywords: ["frontend"], location: ["pune"] },
    filters_key: '{"jobTitleKeywords":["frontend"],"location":["pune"]}',
    frequency: "weekly",
    is_alert_on: true,
    created_at: "2026-11-01T00:00:00.000Z",
    last_sent_at: null,
    last_checked_at: null,
    source: "feed_banner",
    ...overrides,
  };
}
