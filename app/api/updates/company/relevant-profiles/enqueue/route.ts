import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  INTERNAL_API_SECRET,
  sendEmailForStatusUpdate,
} from "@/utils/serverUtils";

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
    const { data: usersData, error: userError } = await supabase.rpc(
      "get_users_needing_match",
    );

    if (!usersData || !usersData.length || userError) {
      console.log(userError);
      return NextResponse.json(
        { success: true, message: "No unmatched users found." },
        { status: 500 },
      );
    }

    console.log("are eligible users present?: ", usersData.length);

    const { data: jobPostings, error: jobPostingsError } = await supabase
      .from("job_postings")
      .select("id, company_info(user_id, email, name) ")
      .eq("status", "active");

    if (jobPostingsError || !jobPostings || jobPostings.length === 0) {
      await sendEmailForStatusUpdate(
        "PROFILE RELEVANCE CRON: No eligible job postings found.",
      );
      return NextResponse.json({
        success: true,
        message: "No job postings to enqueue.",
      });
    }

    // Enqueue one message per user
    const messages = jobPostings.map((job) => ({
      userId: job.company_info.user_id,
      jobId: job.id,
    }));

    for (const message of messages) {
      await supabase.schema("pgmq_public").rpc("send", {
        queue_name: "relevance_profiles",
        message,
        sleep_seconds: 0,
      });
    }

    await sendEmailForStatusUpdate(
      `PROFILE RELEVANCE CRON: Enqueued ${messages.length} users for relevance update.`,
    );

    return NextResponse.json({
      success: true,
      message: `Enqueued ${messages.length} users.`,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await sendEmailForStatusUpdate(
      `PROFILE RELEVANCE CRON CRITICAL FAILURE:\n${errorMsg}`,
    );
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 },
    );
  }
}
