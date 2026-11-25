"use server";

import { z } from "zod";
import { firstIssue, noteSchema } from "@/helpers/tracker/schema";
import { requireTrackerUser, revalidateMyJobs } from "@/helpers/tracker/session";
import { saveApplicationNote } from "@/helpers/tracker/writes";

/**
 * SERVER ACTION (AT-REQ-039): the session applicant's private note and
 * follow-up date on their own GetHired application.
 */
export async function saveApplicationNoteAction(
  input: z.input<typeof noteSchema>,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "error" | "invalid" | "auth"; error: string }> {
  const session = await requireTrackerUser();
  if (!session.ok) return { ok: false, reason: "auth", error: session.error };

  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", error: firstIssue(parsed.error) };

  const result = await saveApplicationNote(session.ctx, parsed.data);
  if (result.ok) revalidateMyJobs();
  return result;
}
