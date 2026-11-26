/**
 * What a job alert tool call would do (JA-REQ-060, 061), for the chat's
 * approval card and MCP's confirmation. It only reads, and returns an error
 * when the call would fail anyway, so the user isn't asked about it.
 */
import "server-only";
import { searchJobs } from "@/helpers/jobs/search-jobs";
import { reportError } from "@/helpers/posthog/report-error";
import {
  JOB_ALERT_COLUMNS,
  JOB_ALERT_COPY,
  MAX_ACTIVE_JOB_ALERTS,
  MAX_JOB_ALERT_ROWS,
  type JobAlertsContext,
} from "./alerts";
import { canonicalAlert } from "./canonical";
import { withAlertCurrency } from "./create-alert";
import type { AlertFilters, JobAlertFrequency } from "./filters";
import { alertName } from "./name";
import { alertSearchParams } from "./search-params";
import { alertFiltersFromTool, createJobAlertInput, updateJobAlertInput } from "./tool-input";

export const JOB_ALERT_SAMPLE_SIZE = 3;

export type JobAlertTool = "createJobAlert" | "updateJobAlert";

export type JobAlertPreview =
  | { ok: false; error: string }
  | {
      ok: true;
      action: "create";
      name: string;
      frequency: JobAlertFrequency;
      /** The alert already saved for this search, which the call turns on or changes. */
      existing: { on: boolean; frequency: JobAlertFrequency } | null;
      /** Jobs matching now (posting text); null when the search failed. */
      sample: { total: number; jobs: { id: string; title: string; company: string }[] } | null;
    }
  | {
      ok: true;
      action: "update";
      name: string;
      changes: { label: string; before: string; after: string }[];
    };

const fail = (error: string) => ({ ok: false as const, error });
const frequencyLabel = (frequency: string) => (frequency === "daily" ? "Daily" : "Weekly");
const stateLabel = (on: boolean) => (on ? "On" : "Paused");
const activeCount = (rows: { is_alert_on: boolean }[]) => rows.filter((row) => row.is_alert_on).length;

export async function previewJobAlert(
  ctx: JobAlertsContext,
  tool: JobAlertTool,
  input: unknown,
): Promise<JobAlertPreview> {
  return tool === "createJobAlert" ? previewCreate(ctx, input) : previewUpdate(ctx, input);
}

/** Every one of the user's rows: the row limit counts them all. */
async function loadRows({ supabase, userId }: JobAlertsContext) {
  const { data, error } = await supabase.from("bookmarks").select(JOB_ALERT_COLUMNS).eq("user_id", userId);
  if (error) throw new Error(`Failed to load job alerts: ${error.message}`);
  return data ?? [];
}

async function previewCreate(ctx: JobAlertsContext, input: unknown): Promise<JobAlertPreview> {
  const parsed = createJobAlertInput.safeParse(input);
  if (!parsed.success) return fail(JOB_ALERT_COPY.notAlertable);
  const filters = alertFiltersFromTool(parsed.data.filters);
  if (!filters) return fail(JOB_ALERT_COPY.notAlertable);

  const withCurrency = await withAlertCurrency(ctx, filters);
  if (!withCurrency) return fail(JOB_ALERT_COPY.noCurrency);
  const { filters: canonical, key } = await canonicalAlert(withCurrency);

  const rows = await loadRows(ctx);
  const existing = rows.find((row) => row.filters_key === key);
  if (!existing && rows.length >= MAX_JOB_ALERT_ROWS) return fail(JOB_ALERT_COPY.rowLimit);
  if (!existing?.is_alert_on && activeCount(rows) >= MAX_ACTIVE_JOB_ALERTS) return fail(JOB_ALERT_COPY.cap);

  return {
    ok: true,
    action: "create",
    name: existing?.name ?? alertName(canonical),
    frequency: parsed.data.frequency,
    existing: existing
      ? { on: existing.is_alert_on, frequency: existing.frequency === "daily" ? "daily" : "weekly" }
      : null,
    sample: await sampleJobs(ctx, canonical),
  };
}

async function sampleJobs(ctx: JobAlertsContext, filters: AlertFilters) {
  try {
    const result = await searchJobs(ctx.supabase, null, {
      ...alertSearchParams(filters),
      limit: JOB_ALERT_SAMPLE_SIZE,
    });
    if (!result.ok) return null;
    const jobs = result.data.slice(0, JOB_ALERT_SAMPLE_SIZE).map((job) => ({
      id: job.id,
      title: job.job_name ?? "Untitled job",
      company: job.company_name ?? "Unknown company",
    }));
    return { total: Math.max(result.totalCount, jobs.length), jobs };
  } catch (error) {
    // The alert can still be created without a sample.
    reportError("[job alerts] couldn't load sample jobs", error);
    return null;
  }
}

async function previewUpdate(ctx: JobAlertsContext, input: unknown): Promise<JobAlertPreview> {
  const parsed = updateJobAlertInput.safeParse(input);
  if (!parsed.success) return fail(JOB_ALERT_COPY.notFound);
  const { alertId, on, frequency } = parsed.data;
  if (on === undefined && frequency === undefined) return fail(JOB_ALERT_COPY.noChange);

  const rows = await loadRows(ctx);
  const row = rows.find((r) => r.id === alertId);
  if (!row) return fail(JOB_ALERT_COPY.notFound);
  if (on && !row.is_alert_on && activeCount(rows) >= MAX_ACTIVE_JOB_ALERTS) return fail(JOB_ALERT_COPY.cap);

  const changes: { label: string; before: string; after: string }[] = [];
  if (on !== undefined) changes.push({ label: "Status", before: stateLabel(row.is_alert_on), after: stateLabel(on) });
  if (frequency !== undefined) {
    changes.push({ label: "Emails", before: frequencyLabel(row.frequency), after: frequencyLabel(frequency) });
  }
  return { ok: true, action: "update", name: row.name, changes };
}
