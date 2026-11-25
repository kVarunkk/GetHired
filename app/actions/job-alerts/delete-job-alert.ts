"use server";

import { z } from "zod";
import { JOB_ALERT_COPY } from "@/helpers/job-alerts/alerts";
import { deleteJobAlert, type DeleteJobAlertResult } from "@/helpers/job-alerts/writes";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";
import { requireAlertSession } from "@/helpers/job-alerts/session";

const inputSchema = z.object({ id: z.string().uuid() }).strict();

/** SERVER ACTION (JA-REQ-021): deletes one of the session user's alerts. */
export async function deleteJobAlertAction(input: z.input<typeof inputSchema>): Promise<DeleteJobAlertResult> {
  const session = await requireAlertSession();
  if (!session.ok) return session;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "not_found", error: JOB_ALERT_COPY.notFound };

  const result = await deleteJobAlert(session.ctx, parsed.data);
  if (!result.ok) return result;

  await eventCaptureServer({ event: PostHogEvent.JobAlertDeleted, distinctId: session.ctx.userId });
  return result;
}
