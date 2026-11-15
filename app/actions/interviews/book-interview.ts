"use server";

import { revalidatePath } from "next/cache";
import { applicationPath } from "@/helpers/applications/application-page";
import { calendarProvider } from "@/helpers/calendar/active-provider";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { schedulingMessage } from "@/helpers/calendar/copy";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { bookInterview, type BookResult } from "@/helpers/interviews/scheduling";
import type { BookInterviewInput } from "@/helpers/interviews/scheduling-schema";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * SERVER ACTION (IVT-043, IV-REQ-020 "Book"): books an interview on the
 * session member's Google Calendar with a Meet link. `book_interview` checks
 * scheduling.manage for the application's job and the member's connection.
 * `candidateInvited: false` means the candidate won't get a calendar invite
 * (D20), which the scheduler says.
 */
export async function bookInterviewAction(input: BookInterviewInput): Promise<BookResult> {
  if (!calendarEnabled()) return { ok: false, reason: "disabled", error: schedulingMessage("disabled") };
  const auth = await requireCompanyForAction({ permission: "scheduling.manage" });
  if (!auth.ok) return { ok: false, reason: "forbidden", error: auth.error };

  const result = await bookInterview(
    { supabase: auth.supabase, admin: createServiceRoleClient(), provider: calendarProvider(), userId: auth.user.id },
    input,
  );
  if (result.ok) revalidatePath(applicationPath(result.applicationId), "layout");
  return result;
}
