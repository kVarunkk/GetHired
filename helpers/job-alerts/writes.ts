import "server-only";
import { reportError } from "@/helpers/posthog/report-error";
import {
  isAlertCapError,
  JOB_ALERT_COLUMNS,
  JOB_ALERT_COPY,
  type JobAlert,
  type JobAlertFailure,
  type JobAlertsContext,
  toJobAlert,
} from "./alerts";
import type { JobAlertFrequency } from "./filters";
import { cleanAlertName } from "./name";

export type UpdateJobAlertInput = { id: string; on?: boolean; frequency?: JobAlertFrequency; name?: string };
export type UpdateJobAlertResult = { ok: true; alert: JobAlert; changed: ("on" | "frequency" | "name")[] } | JobAlertFailure;

/** Pause, resume, change the frequency or rename one of `ctx.userId`'s alerts (JA-REQ-021). */
export async function updateJobAlert(ctx: JobAlertsContext, input: UpdateJobAlertInput): Promise<UpdateJobAlertResult> {
  const patch: { is_alert_on?: boolean; frequency?: JobAlertFrequency; name?: string } = {};
  const changed: ("on" | "frequency" | "name")[] = [];
  if (input.on !== undefined) {
    patch.is_alert_on = input.on;
    changed.push("on");
  }
  if (input.frequency !== undefined) {
    patch.frequency = input.frequency;
    changed.push("frequency");
  }
  if (input.name !== undefined) {
    const name = cleanAlertName(input.name);
    if (!name) return { ok: false, reason: "bad_input", error: JOB_ALERT_COPY.badName };
    patch.name = name;
    changed.push("name");
  }
  if (changed.length === 0) return { ok: false, reason: "bad_input", error: JOB_ALERT_COPY.failed };

  const { data, error } = await ctx.supabase
    .from("bookmarks")
    .update(patch)
    .eq("id", input.id)
    .eq("user_id", ctx.userId)
    .select(JOB_ALERT_COLUMNS)
    .maybeSingle();
  if (error) {
    if (isAlertCapError(error)) return { ok: false, reason: "cap", error: JOB_ALERT_COPY.cap };
    reportError("[job alerts] couldn't update an alert", error);
    return { ok: false, reason: "failed", error: JOB_ALERT_COPY.failed };
  }
  if (!data) return { ok: false, reason: "not_found", error: JOB_ALERT_COPY.notFound };
  return { ok: true, alert: toJobAlert(data), changed };
}

export type DeleteJobAlertResult = { ok: true } | JobAlertFailure;

export async function deleteJobAlert(ctx: JobAlertsContext, { id }: { id: string }): Promise<DeleteJobAlertResult> {
  const { data, error } = await ctx.supabase
    .from("bookmarks")
    .delete()
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .select("id");
  if (error) {
    reportError("[job alerts] couldn't delete an alert", error);
    return { ok: false, reason: "failed", error: JOB_ALERT_COPY.failed };
  }
  if (!data || data.length === 0) return { ok: false, reason: "not_found", error: JOB_ALERT_COPY.notFound };
  return { ok: true };
}

/** The user's alerts, newest first: Settings, and later the agent's `listJobAlerts`. */
export async function listJobAlerts(ctx: JobAlertsContext): Promise<JobAlert[]> {
  const { data, error } = await ctx.supabase
    .from("bookmarks")
    .select(JOB_ALERT_COLUMNS)
    .eq("user_id", ctx.userId)
    .not("filters_key", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to load job alerts: ${error.message}`);
  return (data ?? []).map(toJobAlert);
}
