import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  APPLICANT_DIGEST_QUEUE,
  digestSince,
  type ApplicantDigestMessage,
} from "@/helpers/notifications/new-applicants";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

/**
 * The daily applicant digest (PL-TASK-040), at 09:00 IST: queues one message
 * per company on `daily` with applications since its last digest.
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  try {
    const { data: companies, error } = await admin
      .from("company_info")
      .select("id, last_applicant_digest_at")
      .eq("notify_new_applicants", "daily");
    if (error) throw new Error(`Couldn't read companies: ${error.message}`);

    const messages: ApplicantDigestMessage[] = [];
    for (const company of companies ?? []) {
      const { data: apps, error: appsError } = await admin
        .from("applications")
        .select("id, job_postings!inner(company_id)")
        .eq("job_postings.company_id", company.id)
        .gt("created_at", digestSince(company.last_applicant_digest_at))
        .limit(1);
      if (appsError) throw new Error(`Couldn't read applications: ${appsError.message}`);
      if (apps && apps.length > 0) messages.push({ companyId: company.id });
    }

    if (messages.length > 0) {
      const { error: sendError } = await admin.schema("pgmq_public").rpc("send_batch", {
        queue_name: APPLICANT_DIGEST_QUEUE,
        messages,
        sleep_seconds: 0,
      });
      if (sendError) throw new Error(`Couldn't queue the digests: ${sendError.message}`);
    }

    return NextResponse.json({ success: true, queued: messages.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sendEmailForStatusUpdate(`APPLICANT DIGEST CRON CRITICAL FAILURE:\n${message}`);
    return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
  }
}
