import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/helpers/posthog/report-error";
import { calendarProvider } from "@/helpers/calendar/active-provider";
import { revokePendingCalendars } from "@/helpers/calendar/disconnect";
import { processCalendarOps } from "@/helpers/interviews/calendar-ops";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

/**
 * Every few minutes (IVT-047): runs the queued Google event changes, then
 * revokes the grants of members who left or were removed (§4 Removal).
 * Called by the scheduler with X-Internal-Secret. Ops that gave up are
 * emailed once, on their last read.
 */
async function run(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  try {
    const ops = await processCalendarOps(admin, calendarProvider());
    const revocations = await revokePendingCalendars(admin);
    if (ops.gaveUp.length > 0) {
      await sendEmailForStatusUpdate(
        `INTERVIEW CALENDAR OPS: gave up on ${ops.gaveUp.length}\n${ops.gaveUp.join("\n")}`,
      );
    }
    return NextResponse.json({ ...ops, gaveUp: ops.gaveUp.length, revocations });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportError("[interview calendar ops]", message);
    await sendEmailForStatusUpdate(`INTERVIEW CALENDAR OPS WORKER FAILURE:\n${message}`);
    return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
