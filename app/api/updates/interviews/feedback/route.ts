import { NextRequest, NextResponse } from "next/server";
import { sendInterviewFeedbackEmails } from "@/helpers/interviews/feedback-emails";
import { reportError } from "@/helpers/posthog/report-error";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

/**
 * Every 15 minutes (IVT-070, IV-REQ-040): asks each interviewer for their
 * scorecard when an interview is over, and reminds them once after 24 h.
 * Called by the scheduler with X-Internal-Secret. Failed sends are retried by
 * the next run and emailed in one summary.
 */
async function run(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await sendInterviewFeedbackEmails(createServiceRoleClient());
    if (summary.failures.length > 0) {
      reportError("[interview feedback emails]", `${summary.failures.length} failed`);
      await sendEmailForStatusUpdate(
        `INTERVIEW FEEDBACK EMAILS: ${summary.failures.length} failed of ${summary.due}\n${summary.failures.join("\n")}`,
      );
    }
    return NextResponse.json({ ...summary, failures: summary.failures.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportError("[interview feedback emails]", message);
    await sendEmailForStatusUpdate(`INTERVIEW FEEDBACK EMAILS CRON FAILURE:\n${message}`);
    return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
