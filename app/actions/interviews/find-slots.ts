"use server";

import { calendarProvider } from "@/helpers/calendar/active-provider";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { schedulingMessage } from "@/helpers/calendar/copy";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { findInterviewSlots, type FindSlotsResult } from "@/helpers/interviews/scheduling";
import type { FindSlotsInput } from "@/helpers/interviews/scheduling-schema";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * SERVER ACTION (IVT-042, IV-REQ-012/020): the panel's open slots for the
 * scheduler's Book tab. Needs scheduling.manage for the job, which
 * panel_calendar_status checks again.
 */
export async function findInterviewSlotsAction(input: FindSlotsInput): Promise<FindSlotsResult> {
  if (!calendarEnabled()) return { ok: false, reason: "disabled", error: schedulingMessage("disabled") };
  const auth = await requireCompanyForAction({ permission: "scheduling.manage", jobId: input.jobPostId });
  if (!auth.ok) return { ok: false, reason: "forbidden", error: auth.error };

  return findInterviewSlots(
    { supabase: auth.supabase, admin: createServiceRoleClient(), provider: calendarProvider(), userId: auth.user.id },
    input,
  );
}
