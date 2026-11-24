"use server";

import { z } from "zod";
import { firstIssue, trackedUpdateSchema } from "@/helpers/tracker/schema";
import { requireTrackerUser, revalidateMyJobs } from "@/helpers/tracker/session";
import { updateTrackedApplication, type WriteResult } from "@/helpers/tracker/writes";

const idSchema = z.string().uuid();

/** SERVER ACTION (AT-REQ-038): edits the session applicant's own tracked card. */
export async function updateTrackedApplicationAction(
  id: string,
  update: z.input<typeof trackedUpdateSchema>,
): Promise<WriteResult | { ok: false; reason: "invalid" | "auth"; error: string }> {
  const session = await requireTrackerUser();
  if (!session.ok) return { ok: false, reason: "auth", error: session.error };

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, reason: "not_found", error: "Application not found." };
  const parsed = trackedUpdateSchema.safeParse(update);
  if (!parsed.success) return { ok: false, reason: "invalid", error: firstIssue(parsed.error) };

  const result = await updateTrackedApplication(session.ctx, parsedId.data, parsed.data);
  if (result.ok) revalidateMyJobs();
  return result;
}
