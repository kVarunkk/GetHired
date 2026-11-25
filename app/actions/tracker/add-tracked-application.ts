"use server";

import { addTrackedApplication, type AddTrackedResult } from "@/helpers/tracker/add-tracked-application";
import { firstIssue, trackedInputSchema, type TrackedInputRaw } from "@/helpers/tracker/schema";
import { requireTrackerUser, revalidateMyJobs } from "@/helpers/tracker/session";

export type AddTrackedApplicationActionResult = AddTrackedResult | { ok: false; reason: "invalid" | "auth"; error: string };

/**
 * SERVER ACTION (AT-REQ-036): Add job, typed in (`manual`) or read from a
 * link (`url`). The user comes from the session.
 */
export async function addTrackedApplicationAction(
  input: TrackedInputRaw,
  source: "manual" | "url" = "manual",
): Promise<AddTrackedApplicationActionResult> {
  const session = await requireTrackerUser();
  if (!session.ok) return { ok: false, reason: "auth", error: session.error };

  const parsed = trackedInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", error: firstIssue(parsed.error) };

  const result = await addTrackedApplication(session.ctx, parsed.data, source === "url" ? "url" : "manual");
  if (result.ok) revalidateMyJobs();
  return result;
}
