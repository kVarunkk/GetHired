"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/helpers/agent/auth";
import { applicationPath } from "@/helpers/applications/application-page";
import { calendarProvider } from "@/helpers/calendar/active-provider";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { cancelInterview, type LifecycleResult } from "@/helpers/interviews/interviews";
import { interviewMessage } from "@/helpers/interviews/copy";
import { syncCancelledInterview, type CalendarFollowUp } from "@/helpers/interviews/scheduling";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * SERVER ACTION (IVT-018): cancels an awaiting or scheduled interview.
 * `cancel_interview` checks `scheduling.manage` for its job. Once it applied,
 * a booked interview's Google event is deleted (IVT-044); Google emails the
 * attendees.
 */
export async function cancelInterviewAction({
  interviewId,
}: {
  interviewId: string;
}): Promise<LifecycleResult & CalendarFollowUp> {
  if (!isUuid(interviewId)) return { ok: false, error: interviewMessage("not_found") };
  const auth = await requireCompanyForAction({ permission: "scheduling.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await cancelInterview(auth.supabase, interviewId);
  if (!result.ok) return result;
  revalidatePath(applicationPath(result.applicationId), "layout");
  if (!calendarEnabled()) return result;
  const followUp = await syncCancelledInterview(
    { supabase: auth.supabase, admin: createServiceRoleClient(), provider: calendarProvider(), userId: auth.user.id },
    interviewId,
  );
  return { ...result, ...followUp };
}
