"use server";

import { revalidatePath } from "next/cache";
import { disconnectCalendar } from "@/helpers/calendar/disconnect";
import { MY_CALENDAR_PATH } from "@/helpers/calendar/config";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { reportError } from "@/helpers/posthog/report-error";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * SERVER ACTION (IVT-036, IV-REQ-010): disconnects the session member's own
 * Google Calendar. Revokes at Google and deletes the connection and tokens,
 * even when Google doesn't answer. Service role: members can't touch tokens.
 */
export async function disconnectCalendarAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  try {
    await disconnectCalendar(createServiceRoleClient(), auth.user.id);
  } catch (err) {
    reportError("[calendar] disconnect failed", err instanceof Error ? err.message : "error");
    return { ok: false, error: "Couldn't disconnect your calendar. Please try again." };
  }
  revalidatePath(MY_CALENDAR_PATH);
  return { ok: true };
}
