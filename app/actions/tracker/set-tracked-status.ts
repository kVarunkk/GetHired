"use server";

import { z } from "zod";
import { appliedStatusSchema, firstIssue, optionalDate } from "@/helpers/tracker/schema";
import { requireTrackerUser, revalidateMyJobs } from "@/helpers/tracker/session";
import { setTrackedStatus, type WriteResult } from "@/helpers/tracker/writes";

const inputSchema = z.object({
  id: z.string().uuid(),
  status: appliedStatusSchema,
  position: z.number().finite().optional(),
  appliedAt: optionalDate,
});

/**
 * SERVER ACTION (AT-REQ-015, AT-REQ-026): moves the session applicant's own
 * tracked card (a drag, the Closed menu, "Move to…", Mark as applied). Never
 * back to Saved.
 */
export async function setTrackedStatusAction(
  input: z.input<typeof inputSchema>,
): Promise<WriteResult | { ok: false; reason: "invalid" | "auth"; error: string }> {
  const session = await requireTrackerUser();
  if (!session.ok) return { ok: false, reason: "auth", error: session.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", error: firstIssue(parsed.error) };
  const { id, status, position, appliedAt } = parsed.data;

  const result = await setTrackedStatus(session.ctx, id, status, { position, appliedAt });
  if (result.ok) revalidateMyJobs();
  return result;
}
