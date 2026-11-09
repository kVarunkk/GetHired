"use server";

import { z } from "zod";
import { loadResumeChanges, type LoadResumeChangesResult } from "@/helpers/resume-review/load-changes";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";

/**
 * SERVER ACTION: a review's changes for the agent's card (RI-REQ-023). It loads
 * by id, so the card survives a reload and can reopen an older review. The user
 * comes from the session.
 */
export async function loadResumeChangesAction(reviewId: unknown): Promise<LoadResumeChangesResult> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: "Sign in first." };

  const parsed = z.string().uuid().safeParse(reviewId);
  if (!parsed.success) return { ok: false, error: "This review isn't available any more." };

  return loadResumeChanges(await createClient(), user, parsed.data);
}
