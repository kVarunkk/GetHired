import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { WEEKLY_MATCHES_QUEUE, type WeeklyMatchesMessage } from "@/helpers/notifications/weekly-matches";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

/**
 * Monday's matches email (PL-TASK-041, PL-REQ-010): queues one message per
 * company that hasn't opted out and has an active job.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  try {
    const { data: companies, error } = await admin
      .from("company_info")
      .select("id, job_postings!inner(id)")
      .eq("notify_weekly_matches", true)
      .eq("job_postings.status", "active");
    if (error) throw new Error(`Couldn't read companies: ${error.message}`);

    const messages: WeeklyMatchesMessage[] = (companies ?? []).map((c) => ({ companyId: c.id }));
    if (messages.length > 0) {
      const { error: sendError } = await admin.schema("pgmq_public").rpc("send_batch", {
        queue_name: WEEKLY_MATCHES_QUEUE,
        messages,
        sleep_seconds: 0,
      });
      if (sendError) throw new Error(`Couldn't queue the emails: ${sendError.message}`);
    }

    return NextResponse.json({ success: true, queued: messages.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sendEmailForStatusUpdate(`WEEKLY MATCHES CRON CRITICAL FAILURE:\n${message}`);
    return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
  }
}
