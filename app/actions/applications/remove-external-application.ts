"use server";

import { z } from "zod";
import { loadExternalJob } from "@/helpers/applications/external-application";
import { TRACKER_COPY } from "@/helpers/tracker/copy";
import { trackedIdForBoardJob } from "@/helpers/tracker/legacy";
import { requireTrackerUser, revalidateMyJobs } from "@/helpers/tracker/session";
import { removeTrackedApplication } from "@/helpers/tracker/writes";

const inputSchema = z.object({ allJobsId: z.string().uuid() }).strict();

export type RemoveExternalApplicationResult = { ok: true } | { ok: false; error: string };

/**
 * SERVER ACTION (BW-F08, AT-REQ-035): removes the session applicant's own
 * tracked card for an external board job, with its timeline. An old external
 * `applications` row goes too.
 */
export async function removeExternalApplicationAction(
  input: z.input<typeof inputSchema>,
): Promise<RemoveExternalApplicationResult> {
  const session = await requireTrackerUser();
  if (!session.ok) return { ok: false, error: session.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: TRACKER_COPY.notFound };
  const { allJobsId } = parsed.data;

  const job = await loadExternalJob(session.ctx.supabase, allJobsId);
  if (!job.ok) return job;

  const card = await trackedIdForBoardJob(session.ctx, allJobsId);
  if (!card.ok) return { ok: false, error: "An unexpected error occurred." };
  if (!card.id) return { ok: false, error: TRACKER_COPY.notFound };

  const result = await removeTrackedApplication(session.ctx, card.id);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateMyJobs();
  return { ok: true };
}
