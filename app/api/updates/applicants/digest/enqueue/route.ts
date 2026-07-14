import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAllDigestUsers } from "@/helpers/jobs/digest-utils";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

export async function GET() {
  const headersList = await headers();

  const cronSecret = headersList.get("X-Internal-Secret");
  if (cronSecret !== INTERNAL_API_SECRET) {
    return NextResponse.json(
      { message: "Unauthorized access to digest route" },
      { status: 401 },
    );
  }

  const supabase = createServiceRoleClient();

  try {
    const users = await getAllDigestUsers();

    if (!users || users.length === 0) {
      await sendEmailForStatusUpdate(
        "JOB DIGEST USER NOT FOUND. EXITING SUCCESFULLY.",
      );
      return NextResponse.json({
        success: true,
        message: "No users found for digest today.",
      });
    }

    for (const user of users) {
      await supabase.schema("pgmq_public").rpc("send", {
        queue_name: "job_digest",
        message: user,
        sleep_seconds: 0,
      });
    }

    await sendEmailForStatusUpdate(
      `JOB DIGEST CRON: Enqueued ${users.length} users for relevance update.`,
    );

    return NextResponse.json({
      success: true,
      message: `Enqueued ${users.length} users.`,
    });
  } catch (error) {
    console.error("Global Job Digest Execution Failed:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);

    await sendEmailForStatusUpdate(
      [`JOB DIGEST CRITICAL FAILURE:`, `Error: ${errorMsg}`].join("\n"),
    );

    return NextResponse.json(
      { success: false, message: "Failed to initialize digest process." },
      { status: 500 },
    );
  }
}
