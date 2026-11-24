"use server";

import { z } from "zod";
import { loadExternalJob } from "@/helpers/applications/external-application";
import { TRACKER_COPY } from "@/helpers/tracker/copy";
import { trackedIdForBoardJob } from "@/helpers/tracker/legacy";
import { appliedStatusSchema } from "@/helpers/tracker/schema";
import { requireTrackerUser, revalidateMyJobs } from "@/helpers/tracker/session";
import { legacyTrackedStatus, type AppliedStatus } from "@/helpers/tracker/status";
import { setTrackedStatus } from "@/helpers/tracker/writes";
import { Constants } from "@/utils/types/database.types";

// The old `application_status` values still work (deployed clients send
// them); the menu now sends tracked statuses (AT-REQ-035).
const statusSchema = z.union([appliedStatusSchema, z.enum(Constants.public.Enums.application_status)]);

const inputSchema = z.object({ allJobsId: z.string().uuid(), status: statusSchema }).strict();

export type SetExternalApplicationStatusResult = { ok: true } | { ok: false; error: string };

const toTracked = (status: z.output<typeof statusSchema>): AppliedStatus =>
  appliedStatusSchema.safeParse(status).success ? (status as AppliedStatus) : legacyTrackedStatus(status as never);

/**
 * SERVER ACTION (BW-F02, AT-REQ-035): the status of the session applicant's
 * own tracked card for an external board job. An old external
 * `applications` row is copied into the tracker first.
 */
export async function setExternalApplicationStatusAction(
  input: z.input<typeof inputSchema>,
): Promise<SetExternalApplicationStatusResult> {
  const session = await requireTrackerUser();
  if (!session.ok) return { ok: false, error: session.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid status." };
  const { allJobsId, status } = parsed.data;

  const job = await loadExternalJob(session.ctx.supabase, allJobsId);
  if (!job.ok) return job;

  const card = await trackedIdForBoardJob(session.ctx, allJobsId);
  if (!card.ok) return { ok: false, error: card.reason === "limit" ? TRACKER_COPY.limit : "An unexpected error occurred." };
  if (!card.id) return { ok: false, error: TRACKER_COPY.notFound };

  const result = await setTrackedStatus(session.ctx, card.id, toTracked(status));
  if (!result.ok) return { ok: false, error: result.reason === "not_found" ? TRACKER_COPY.notFound : "An unexpected error occurred." };

  revalidateMyJobs();
  return { ok: true };
}
