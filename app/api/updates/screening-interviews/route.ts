import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { expireInterviews, sendReminders, sweepSessions } from "@/helpers/interview/screening/lifecycle-cron";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

/**
 * Every 15 minutes (SI-TASK-013): expire invites past their deadline, send
 * the 48-hour reminders, and sweep screening sessions whose callback never
 * came. Called by the scheduler with X-Internal-Secret.
 */
async function run(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  try {
    const expired = await expireInterviews(admin);
    const reminded = await sendReminders(admin);
    const swept = await sweepSessions(admin);
    return NextResponse.json({ expired, reminded, swept });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[screening cron]", message);
    await sendEmailForStatusUpdate(`SCREENING INTERVIEWS CRON FAILURE:\n${message}`);
    return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
