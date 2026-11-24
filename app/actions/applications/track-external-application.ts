"use server";

import { z } from "zod";
import { loadExternalJob } from "@/helpers/applications/external-application";
import { addTrackedApplication } from "@/helpers/tracker/add-tracked-application";
import { requireTrackerUser, revalidateMyJobs } from "@/helpers/tracker/session";

const inputSchema = z.object({ allJobsId: z.string().uuid() }).strict();

export type TrackExternalApplicationResult = { ok: true } | { ok: false; error: string };

/**
 * SERVER ACTION (BW-F02, AT-REQ-033): "Did you apply?" on an external board
 * job. Same input and refusals as before; the card now goes to the tracker
 * (source `board_prompt`) instead of `applications`.
 */
export async function trackExternalApplicationAction(
  input: z.input<typeof inputSchema>,
): Promise<TrackExternalApplicationResult> {
  const session = await requireTrackerUser();
  if (!session.ok) return { ok: false, error: session.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Job not found." };
  const { allJobsId } = parsed.data;

  const job = await loadExternalJob(session.ctx.supabase, allJobsId);
  if (!job.ok) return job;

  const result = await addTrackedApplication(
    session.ctx,
    { allJobsId, status: "applied", appliedAt: null, nextFollowUpAt: null, notes: null, resumeId: null },
    "board_prompt",
  );
  // Already applied through GetHired: it's on the board already.
  if (!result.ok && result.reason !== "applied_on_gethired") return { ok: false, error: result.error };

  revalidateMyJobs();
  return { ok: true };
}
