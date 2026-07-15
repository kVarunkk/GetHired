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
    const { data: users, error: userError } = await supabase
      .from("user_info")
      .select("full_name, email")
      .eq("filled", true)
      .lt("ai_credits", TAICredits.AI_SEARCH_ASK_AI_RESUME);

    if (userError || !users || users.length === 0) {
      await sendEmailForStatusUpdate("RECHARGE CRON: No eligible users found.");
      return NextResponse.json({
        success: true,
        message: "No users to enqueue.",
      });
    }

    const messages = users.map((user) => ({
      name: user.full_name,
      email: user.email,
    }));

    for (const message of messages) {
      await supabase.schema("pgmq_public").rpc("send", {
        queue_name: "recharge_jobs",
        message,
        sleep_seconds: 0,
      });
    }

    await sendEmailForStatusUpdate(
      `RECHARGE CRON: Enqueued ${messages.length} users for recharge update.`,
    );

    return NextResponse.json({
      success: true,
      message: `Enqueued ${messages.length} users.`,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await sendEmailForStatusUpdate(
      `RECHARGE CRON CRITICAL FAILURE:\n${errorMsg}`,
    );
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 },
    );
  }
}
