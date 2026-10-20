import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

/**
 * Daily (OR-TASK-005): outreach still unanswered after 30 days becomes
 * `expired`. Called by pg_cron (GET) or the scheduler (POST) with
 * X-Internal-Secret.
 */
async function expire(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await createServiceRoleClient().rpc("expire_outreach");
  if (error) {
    await sendEmailForStatusUpdate(`OUTREACH EXPIRE CRON FAILURE:\n${error.message}`);
    return NextResponse.json({ success: false, message: "Internal Server Error" }, { status: 500 });
  }
  return NextResponse.json({ expired: data ?? 0 });
}

export const GET = expire;
export const POST = expire;
