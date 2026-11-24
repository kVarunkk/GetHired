"use server";

import { z } from "zod";
import { TRACKER_COPY } from "@/helpers/tracker/copy";
import { requireTrackerUser, revalidateMyJobs } from "@/helpers/tracker/session";
import { removeTrackedApplication } from "@/helpers/tracker/writes";

/** SERVER ACTION (AT-REQ-038): deletes the session applicant's own tracked card and its timeline. */
export async function removeTrackedApplicationAction(
  id: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: "not_found" | "error" | "auth"; error: string }> {
  const session = await requireTrackerUser();
  if (!session.ok) return { ok: false, reason: "auth", error: session.error };

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, reason: "not_found", error: TRACKER_COPY.notFound };

  const result = await removeTrackedApplication(session.ctx, parsed.data);
  if (result.ok) revalidateMyJobs();
  return result;
}
