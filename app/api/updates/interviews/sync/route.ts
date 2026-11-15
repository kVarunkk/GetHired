import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/helpers/posthog/report-error";
import { calendarProvider } from "@/helpers/calendar/active-provider";
import { syncCalendarInterviews } from "@/helpers/interviews/calendar-sync";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

/**
 * Every 15 minutes (IVT-046): completes interviews that are over, follows
 * changes made in Google Calendar (moved, deleted, the panel's answers) and
 * expires self-scheduling links. Called by the scheduler with
 * X-Internal-Secret. Failures for single interviews are emailed in one summary.
 */
async function run(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await syncCalendarInterviews(createServiceRoleClient(), calendarProvider());
    if (summary.failures.length > 0) {
      reportError("[interviews sync]", `${summary.failures.length} failed`);
      await sendEmailForStatusUpdate(
        `INTERVIEWS SYNC: ${summary.failures.length} failed of ${summary.checked}\n${summary.failures.join("\n")}`,
      );
    }
    return NextResponse.json({ ...summary, failures: summary.failures.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportError("[interviews sync]", message);
    await sendEmailForStatusUpdate(`INTERVIEWS SYNC CRON FAILURE:\n${message}`);
    return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
