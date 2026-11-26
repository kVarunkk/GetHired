/**
 * Job alert tools (JA-REQ-060). They run the same core as the app's actions,
 * for the context's user. The writes go through the service-role client,
 * because the alert's derived columns are server-written (JA-REQ-005), so
 * every query there filters `user_id`.
 */
import { tool } from "ai";
import { z } from "zod";
import {
  JOB_ALERT_COPY,
  MAX_ACTIVE_JOB_ALERTS,
  type JobAlert,
  type JobAlertsContext,
} from "@/helpers/job-alerts/alerts";
import { createJobAlert } from "@/helpers/job-alerts/create-alert";
import { alertFilterKeys } from "@/helpers/job-alerts/filters";
import { alertFiltersFromTool, createJobAlertInput, updateJobAlertInput } from "@/helpers/job-alerts/tool-input";
import { listJobAlerts, updateJobAlert } from "@/helpers/job-alerts/writes";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PostHogEvent } from "@/utils/types";
import { AgentToolContext, withToolErrors } from "./shared";

const MANAGE_URL = "/settings#job-alerts";

const alertsContext = (ctx: AgentToolContext): JobAlertsContext => ({
  userId: ctx.user.id,
  supabase: createServiceRoleClient(),
});

const alertSummary = (alert: JobAlert) => ({
  id: alert.id,
  name: alert.name,
  frequency: alert.frequency,
  on: alert.on,
  jobsUrl: alert.url,
});

export function createJobAlertTools(ctx: AgentToolContext) {
  return {
    createJobAlert: tool({
      description:
        "Email the user new jobs matching a search, daily or weekly (a job alert). It takes searchJobs' filters, except visa terms, posting date and experienceYears, which an alert can't keep: say so, and use minExperience/maxExperience for a level the user asked for. An alert already saved for the same search is turned on and gets the new frequency. The user is asked to confirm first.",
      inputSchema: createJobAlertInput,
      execute: ({ filters, frequency }) =>
        withToolErrors(ctx, "createJobAlert", async () => {
          const result = await createJobAlert(alertsContext(ctx), {
            filters: alertFiltersFromTool(filters),
            frequency,
            source: ctx.surface,
          });
          if (!result.ok) {
            if (result.reason === "cap") {
              await eventCaptureServer({
                event: PostHogEvent.JobAlertCapHit,
                distinctId: ctx.user.id,
                properties: { source: ctx.surface, frequency },
              });
            }
            return { error: result.error };
          }
          await eventCaptureServer({
            event: PostHogEvent.JobAlertCreated,
            distinctId: ctx.user.id,
            properties: {
              source: ctx.surface,
              frequency,
              filter_keys: alertFilterKeys(result.alert.filters),
              resumed: result.resumed,
            },
          });
          return {
            alreadyExisted: result.resumed,
            alert: alertSummary(result.alert),
            manageUrl: MANAGE_URL,
          };
        }),
    }),

    listJobAlerts: tool({
      description:
        "List the user's job alerts: each one's id, search, how often it's emailed, whether it's on or paused, and when it was last sent.",
      inputSchema: z.object({}),
      execute: () =>
        withToolErrors(ctx, "listJobAlerts", async () => {
          const alerts = await listJobAlerts(alertsContext(ctx));
          return {
            alerts: alerts.map((alert) => ({
              ...alertSummary(alert),
              filters: alert.filters,
              lastSentAt: alert.lastSentAt,
              createdAt: alert.createdAt,
            })),
            activeCount: alerts.filter((alert) => alert.on).length,
            maxActive: MAX_ACTIVE_JOB_ALERTS,
            manageUrl: MANAGE_URL,
          };
        }),
    }),

    updateJobAlert: tool({
      description:
        "Pause or resume one of the user's job alerts, or change how often it's emailed. Get its id from listJobAlerts. To change what an alert searches for, create a new one and pause the old one. Deleting is done in Settings. The user is asked to confirm first.",
      inputSchema: updateJobAlertInput,
      execute: ({ alertId, on, frequency }) =>
        withToolErrors(ctx, "updateJobAlert", async () => {
          if (on === undefined && frequency === undefined) return { error: JOB_ALERT_COPY.noChange };
          const result = await updateJobAlert(alertsContext(ctx), { id: alertId, on, frequency });
          if (!result.ok) return { error: result.error };
          await eventCaptureServer({
            event: PostHogEvent.JobAlertUpdated,
            distinctId: ctx.user.id,
            properties: { changed: result.changed, ...(on !== undefined ? { on } : {}) },
          });
          return { alert: alertSummary(result.alert), manageUrl: MANAGE_URL };
        }),
    }),
  };
}
