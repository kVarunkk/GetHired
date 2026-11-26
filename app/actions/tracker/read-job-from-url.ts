"use server";

import { after } from "next/server";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { readJobFromUrl, type ReadJobResult } from "@/helpers/tracker/read-job-from-url";
import { requireTrackerUser } from "@/helpers/tracker/session";
import { PostHogEvent } from "@/utils/types";

/**
 * SERVER ACTION (AT-REQ-037): prefills Add job from a link. Free, 20 an hour
 * per user, and it never saves anything. PostHog gets the outcome and the
 * host only.
 */
export async function readJobFromUrlAction(
  url: string,
): Promise<ReadJobResult | { ok: false; reason: "auth"; error: string; jobUrl: null }> {
  const session = await requireTrackerUser();
  if (!session.ok) return { ok: false, reason: "auth", error: session.error, jobUrl: null };
  const userId = session.ctx.user.id;

  return readJobFromUrl(session.ctx, typeof url === "string" ? url : "", {
    onOutcome: ({ outcome, host }) =>
      after(() =>
        eventCaptureServer({ event: PostHogEvent.TrackerUrlRead, distinctId: userId, properties: { outcome, host } }),
      ),
  });
}
