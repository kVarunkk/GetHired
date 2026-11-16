"use server";

import { revalidatePath } from "next/cache";
import { applicationPath } from "@/helpers/applications/application-page";
import { calendarProvider } from "@/helpers/calendar/active-provider";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { updateInterview, type LifecycleResult } from "@/helpers/interviews/interviews";
import type { UpdateInterviewInput } from "@/helpers/interviews/interview-schema";
import { syncUpdatedInterview, type CalendarFollowUp } from "@/helpers/interviews/scheduling";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * SERVER ACTION (IVT-018, IV-REQ-023): reschedules an interview, changes its
 * panel or its meeting link. A removed interviewer's draft scorecard is
 * deleted; a submitted one stays. `update_interview` checks
 * `scheduling.manage` for the interview's job. A booked interview's Google
 * event follows only after the change applied (IVT-044), and a Google
 * failure comes back as `calendarWarning`, not as a failed change.
 */
export async function updateInterviewAction(
  input: UpdateInterviewInput,
): Promise<LifecycleResult & CalendarFollowUp> {
  const auth = await requireCompanyForAction({ permission: "scheduling.manage" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await updateInterview(auth.supabase, input);
  if (!result.ok) return result;
  revalidatePath(applicationPath(result.applicationId), "layout");
  if (!calendarEnabled()) return result;
  const followUp = await syncUpdatedInterview(
    { supabase: auth.supabase, admin: createServiceRoleClient(), provider: calendarProvider(), userId: auth.user.id },
    input.interviewId,
    { time: input.startsAt !== undefined, panel: input.panel !== undefined },
  );
  return { ...result, ...followUp };
}
