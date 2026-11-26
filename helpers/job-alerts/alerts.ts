import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/utils/types/database.types";
import type { AlertFilters, JobAlertFrequency, JobAlertSource } from "./filters";

/** Shared types and copy for the server-side job alert code. */

export type JobAlertsContext = {
  /** The session user (or the tool context's user). Never from input. */
  userId: string;
  /** The service-role client: the derived columns are server-written (JA-REQ-005). */
  supabase: SupabaseClient<Database>;
};

export const JOB_ALERT_COLUMNS =
  "id, name, url, filters, filters_key, frequency, is_alert_on, created_at, last_sent_at, last_checked_at, source" as const;

export type JobAlertRow = Pick<
  Tables<"bookmarks">,
  | "id"
  | "name"
  | "url"
  | "filters"
  | "filters_key"
  | "frequency"
  | "is_alert_on"
  | "created_at"
  | "last_sent_at"
  | "last_checked_at"
  | "source"
>;

/** What the UI gets back for one alert. */
export type JobAlert = {
  id: string;
  name: string;
  url: string;
  filters: AlertFilters;
  frequency: JobAlertFrequency;
  on: boolean;
  createdAt: string;
  lastSentAt: string | null;
  source: JobAlertSource | null;
};

export function toJobAlert(row: JobAlertRow): JobAlert {
  return {
    id: row.id,
    name: row.name,
    url: row.url ?? "/jobs",
    filters: (row.filters ?? {}) as AlertFilters,
    frequency: row.frequency === "daily" ? "daily" : "weekly",
    on: row.is_alert_on,
    createdAt: row.created_at,
    lastSentAt: row.last_sent_at,
    source: (row.source as JobAlertSource | null) ?? null,
  };
}

/** Active job alerts per user. The DB trigger `bookmarks_alert_cap` enforces the same number. */
export const MAX_ACTIVE_JOB_ALERTS = 5;

/** Soft limit on rows per user, active or paused (JA-REQ-004). Not a trigger. */
export const MAX_JOB_ALERT_ROWS = 20;

export const JOB_ALERT_COPY = {
  notAlertable: "Add a role, location or another filter first.",
  noCurrency: "Add a currency to the salary filter first.",
  cap: `You have ${MAX_ACTIVE_JOB_ALERTS} active alerts. Pause one to add this search.`,
  rowLimit: `You have ${MAX_JOB_ALERT_ROWS} job alerts. Delete one in Settings to add another.`,
  notFound: "Alert not found.",
  badName: "Give the alert a name of up to 80 characters.",
  noChange: "Say whether to pause the alert, resume it or change how often it's emailed.",
  failed: "Couldn't save the alert. Please try again.",
  signIn: "Sign in first.",
  applicantsOnly: "Job alerts are for job seekers.",
} as const;

export type JobAlertErrorReason =
  | "not_alertable"
  | "no_currency"
  | "cap"
  | "row_limit"
  | "not_found"
  | "bad_input"
  | "failed";

export type JobAlertFailure = { ok: false; reason: JobAlertErrorReason; error: string };

/** The `bookmarks_alert_cap` trigger's refusal (a check_violation naming the maximum). */
export function isAlertCapError(error: Pick<PostgrestError, "code" | "message"> | null): boolean {
  return !!error && error.code === "23514" && /maximum/i.test(error.message ?? "");
}
