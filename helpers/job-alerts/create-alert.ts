import "server-only";
import { toIsoCurrency } from "@/helpers/currency/currencies";
import { reportError } from "@/helpers/posthog/report-error";
import {
  isAlertCapError,
  JOB_ALERT_COLUMNS,
  JOB_ALERT_COPY,
  MAX_JOB_ALERT_ROWS,
  type JobAlert,
  type JobAlertFailure,
  type JobAlertRow,
  type JobAlertsContext,
  toJobAlert,
} from "./alerts";
import { canonicalAlert } from "./canonical";
import { type AlertFilters, alertJobsPath, type JobAlertFrequency, type JobAlertSource } from "./filters";
import { alertName } from "./name";

export type CreateJobAlertInput = {
  /** From `alertFiltersFromSearchParams` (or the agent's mapped filters); null refuses. */
  filters: AlertFilters | null;
  frequency: JobAlertFrequency;
  source: JobAlertSource;
};

export type CreateJobAlertResult = { ok: true; alert: JobAlert; resumed: boolean } | JobAlertFailure;

const fail = (reason: JobAlertFailure["reason"], error: string): JobAlertFailure => ({ ok: false, reason, error });

/**
 * The one way to create a job alert (JA-REQ-020), shared by the action and the
 * agent and MCP tools. A minimum salary without a currency takes the
 * profile's currency. An alert that already exists for the same search is
 * turned on, gets the new frequency and comes back with `resumed: true`.
 * Everything is written for `ctx.userId`.
 */
export async function createJobAlert(
  ctx: JobAlertsContext,
  { filters, frequency, source }: CreateJobAlertInput,
): Promise<CreateJobAlertResult> {
  if (!filters) return fail("not_alertable", JOB_ALERT_COPY.notAlertable);
  const { supabase, userId } = ctx;

  const withCurrency = await withAlertCurrency(ctx, filters);
  if (!withCurrency) return fail("no_currency", JOB_ALERT_COPY.noCurrency);

  const { filters: canonical, key } = await canonicalAlert(withCurrency);

  const existing = await findByKey(ctx, key);
  if (existing) return turnOn(ctx, existing, frequency);

  const { count, error: countError } = await supabase
    .from("bookmarks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) {
    reportError("[job alerts] couldn't count alerts", countError);
    return fail("failed", JOB_ALERT_COPY.failed);
  }
  if ((count ?? 0) >= MAX_JOB_ALERT_ROWS) return fail("row_limit", JOB_ALERT_COPY.rowLimit);

  const { data: inserted, error } = await supabase
    .from("bookmarks")
    .insert({
      user_id: userId,
      name: alertName(canonical),
      url: alertJobsPath(canonical),
      filters: canonical,
      filters_key: key,
      frequency,
      source,
      is_alert_on: true,
    })
    .select(JOB_ALERT_COLUMNS)
    .single();

  if (error || !inserted) {
    if (isAlertCapError(error)) return fail("cap", JOB_ALERT_COPY.cap);
    // Two tabs creating the same alert at once: the other one won.
    if (error?.code === "23505") {
      const raced = await findByKey(ctx, key);
      if (raced) return turnOn(ctx, raced, frequency);
    }
    reportError("[job alerts] couldn't create an alert", error);
    return fail("failed", JOB_ALERT_COPY.failed);
  }
  return { ok: true, alert: toJobAlert(inserted), resumed: false };
}

/** A minimum salary without a currency takes the profile's. Null when the profile has none either. */
export async function withAlertCurrency(
  { supabase, userId }: JobAlertsContext,
  filters: AlertFilters,
): Promise<AlertFilters | null> {
  if (filters.minSalary === undefined || filters.salaryCurrency) return filters;
  const { data: profile } = await supabase
    .from("user_info")
    .select("salary_currency")
    .eq("user_id", userId)
    .maybeSingle();
  const currency = toIsoCurrency(profile?.salary_currency);
  return currency ? { ...filters, salaryCurrency: currency } : null;
}

async function findByKey(ctx: JobAlertsContext, key: string): Promise<JobAlertRow | null> {
  const { data } = await ctx.supabase
    .from("bookmarks")
    .select(JOB_ALERT_COLUMNS)
    .eq("user_id", ctx.userId)
    .eq("filters_key", key)
    .maybeSingle();
  return data ?? null;
}

async function turnOn(
  ctx: JobAlertsContext,
  row: JobAlertRow,
  frequency: JobAlertFrequency,
): Promise<CreateJobAlertResult> {
  if (row.is_alert_on && row.frequency === frequency) {
    return { ok: true, alert: toJobAlert(row), resumed: true };
  }
  const { data, error } = await ctx.supabase
    .from("bookmarks")
    .update({ is_alert_on: true, frequency })
    .eq("id", row.id)
    .eq("user_id", ctx.userId)
    .select(JOB_ALERT_COLUMNS)
    .single();
  if (error || !data) {
    if (isAlertCapError(error)) return fail("cap", JOB_ALERT_COPY.cap);
    reportError("[job alerts] couldn't resume an alert", error);
    return fail("failed", JOB_ALERT_COPY.failed);
  }
  return { ok: true, alert: toJobAlert(data), resumed: true };
}
