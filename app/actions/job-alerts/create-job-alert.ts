"use server";

import { z } from "zod";
import { JOB_ALERT_COPY, type JobAlert, type JobAlertFailure } from "@/helpers/job-alerts/alerts";
import { createJobAlert } from "@/helpers/job-alerts/create-alert";
import { alertFilterKeys, alertFiltersFromSearchParams } from "@/helpers/job-alerts/filters";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";
import { requireAlertSession } from "@/helpers/job-alerts/session";

const inputSchema = z
  .object({
    /** The search's query string (with or without `?`). The filters are read from it on the server. */
    search: z.string().max(2048),
    frequency: z.enum(["daily", "weekly"]),
    // The sources a browser may claim; agent and MCP use the core directly.
    source: z.enum(["feed_banner", "empty_state", "settings"]),
  })
  .strict();

export type CreateJobAlertActionResult = { ok: true; alert: JobAlert; resumed: boolean } | JobAlertFailure;

/** SERVER ACTION (JA-REQ-020): an alert for a job search, for the session applicant. */
export async function createJobAlertAction(input: z.input<typeof inputSchema>): Promise<CreateJobAlertActionResult> {
  const session = await requireAlertSession();
  if (!session.ok) return session;
  const { ctx } = session;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "bad_input", error: JOB_ALERT_COPY.notAlertable };
  const { search, frequency, source } = parsed.data;

  const filters = alertFiltersFromSearchParams(search);
  const result = await createJobAlert(ctx, { filters, frequency, source });

  if (!result.ok) {
    if (result.reason === "cap") {
      await eventCaptureServer({
        event: PostHogEvent.JobAlertCapHit,
        distinctId: ctx.userId,
        properties: { source, frequency },
      });
    }
    return result;
  }

  await eventCaptureServer({
    event: PostHogEvent.JobAlertCreated,
    distinctId: ctx.userId,
    properties: {
      source,
      frequency,
      filter_keys: alertFilterKeys(result.alert.filters),
      resumed: result.resumed,
    },
  });
  return result;
}
