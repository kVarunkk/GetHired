import "server-only";
import { revalidatePath } from "next/cache";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import { TRACKER_COPY } from "./copy";
import type { TrackerContext } from "./context";
import { MY_JOBS_PATH } from "./paths";

/**
 * The tracker's context for a server action or a route: the session
 * applicant and their client. Companies are refused (AT-REQ-010).
 */
export async function requireTrackerUser(): Promise<{ ok: true; ctx: TrackerContext } | { ok: false; error: string }> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, error: TRACKER_COPY.signIn };
  if (user.app_metadata?.type === "company") return { ok: false, error: TRACKER_COPY.applicantsOnly };
  const supabase = await createClient();
  return { ok: true, ctx: { supabase, user: { id: user.id } } };
}

/** My Jobs and its card pages. */
export const revalidateMyJobs = () => revalidatePath(MY_JOBS_PATH, "layout");
