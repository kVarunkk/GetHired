"use server";

import { z } from "zod";
import { JOB_ALERT_COPY } from "@/helpers/job-alerts/alerts";
import { updateJobAlert, type UpdateJobAlertResult } from "@/helpers/job-alerts/writes";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";
import { requireAlertSession } from "@/helpers/job-alerts/session";

const inputSchema = z
  .object({
    id: z.string().uuid(),
    on: z.boolean().optional(),
    frequency: z.enum(["daily", "weekly"]).optional(),
    name: z.string().max(200).optional(),
  })
  .strict();

/** SERVER ACTION (JA-REQ-021): pause, resume, change the frequency or rename one of the session user's alerts. */
export async function updateJobAlertAction(input: z.input<typeof inputSchema>): Promise<UpdateJobAlertResult> {
  const session = await requireAlertSession();
  if (!session.ok) return session;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "not_found", error: JOB_ALERT_COPY.notFound };

  const result = await updateJobAlert(session.ctx, parsed.data);
  if (!result.ok) return result;

  await eventCaptureServer({
    event: PostHogEvent.JobAlertUpdated,
    distinctId: session.ctx.userId,
    properties: { changed: result.changed, ...(parsed.data.on !== undefined ? { on: parsed.data.on } : {}) },
  });
  return result;
}
