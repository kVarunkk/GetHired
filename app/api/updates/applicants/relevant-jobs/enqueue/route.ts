import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TAICredits } from "@/utils/types";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

export async function GET() {
  const headersList = await headers();
  const cronSecret = headersList.get("X-Internal-Secret");
  if (cronSecret !== INTERNAL_API_SECRET) {
    return NextResponse.json(
      { message: "Unauthorized access" },
      { status: 401 },
    );
  }

  const supabase = createServiceRoleClient();

  try {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoISO = threeDaysAgo.toISOString();

    const { data: users, error: userError } = await supabase
      .from("user_info")
      .select("user_id")
      .eq("filled", true)
      .gte("ai_credits", TAICredits.AI_SEARCH_ASK_AI_RESUME)
      .or(
        `created_at.lt.${threeDaysAgoISO},and(created_at.gte.${threeDaysAgoISO},relevant_jobs_update_status.eq.failed)`,
      );

    if (userError || !users || users.length === 0) {
      await sendEmailForStatusUpdate(
        "RELEVANCE CRON: No eligible users found.",
      );
      return NextResponse.json({
        success: true,
        message: "No users to enqueue.",
      });
    }

    const messages = users.map((user) => ({
      userId: user.user_id,
    }));

    for (const message of messages) {
      await supabase.schema("pgmq_public").rpc("send", {
        queue_name: "relevance_jobs",
        message,
        sleep_seconds: 0,
      });
    }

    await sendEmailForStatusUpdate(
      `RELEVANCE CRON: Enqueued ${messages.length} users for relevance update.`,
    );

    return NextResponse.json({
      success: true,
      message: `Enqueued ${messages.length} users.`,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await sendEmailForStatusUpdate(
      `RELEVANCE CRON CRITICAL FAILURE:\n${errorMsg}`,
    );
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 },
    );
  }
}
