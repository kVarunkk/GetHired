import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Resend } from "resend";
import { render } from "@react-email/render";
import { headers } from "next/headers";
import { sendEmailForStatusUpdate } from "@/lib/serverUtils";
import OnboardingReminderEmail from "@/emails/OnboardingReminderEmail";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const resend = new Resend(RESEND_API_KEY);

export async function GET() {
  const headersList = await headers();
  const cronSecret = headersList.get("x-internal-secret");

  // --- 1. Security Check ---
  if (cronSecret !== INTERNAL_API_SECRET) {
    console.error("CRON Unauthorized Access Attempt: Secret Mismatch");
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  const serviceSupabase = createServiceRoleClient();

  try {
    // 2. Fetch users who have NOT filled their profile AND registered at least 48 hours ago
    const { data: users, error: fetchError } = await serviceSupabase
      .from("user_info")
      .select(`user_id, email, full_name, created_at`)
      .eq("filled", false)
      .eq("is_promotion_active", true);

    if (fetchError) {
      throw new Error(`Database fetch failed: ${fetchError.message}`);
    }

    if (!users || users.length === 0) {
      const report = [
        `Onboarding Reminder Report (${new Date().toISOString()})`,
        "Total Users Targeted: 0",
        "No incomplete profiles older than 48 hours found.",
      ].join("\n");
      await sendEmailForStatusUpdate(report);
      return NextResponse.json({
        success: true,
        message: "No users require onboarding reminder.",
      });
    }

    // 3. Send Emails
    const sendPromises = users.map(async (user) => {
      const userName = user.email.split("@")[0];

      const emailHtml = await render(
        <OnboardingReminderEmail userName={userName} />
      );

      return resend.emails
        .send({
          from: "GetHired <varun@devhub.co.in>",
          to: [user.email],
          subject: "Urgent: Complete Your Profile for Instant Job Matches",
          html: emailHtml,
        })
        .then(() => ({ success: true, email: user.email }))
        .catch((err) =>
          Promise.reject({ email: user.email, reason: err.message })
        );
    });

    const results = await Promise.allSettled(sendPromises);
    const successfulSends = results.filter(
      (r) => r.status === "fulfilled"
    ).length;
    const failedEmails = results
      .filter((r) => r.status === "rejected")
      .map(
        (r) =>
          (r as PromiseRejectedResult).reason as {
            email: string;
            reason: string;
          }
      );

    // 4. Send Final Admin Report
    const report = [
      `ONBOARDING REMINDER REPORT (${new Date().toISOString()})`,
      `Total Users Targeted: ${users.length}`,
      `Successful Sends: ${successfulSends}`,
      `Failed Sends: ${failedEmails.length}`,
      "-------------------------------------------------------",
      `FAILED EMAILS:`,
      ...failedEmails.map((f) => `- ${f.email}: ${f.reason}`),
    ].join("\n");

    await sendEmailForStatusUpdate(report);

    return NextResponse.json({
      success: true,
      message: `Processed ${users.length} reminders. Sent ${successfulSends} emails.`,
    });
  } catch (e) {
    console.error("Critical processing error:", e);
    await sendEmailForStatusUpdate(
      [
        `ONBOARDING REMINDER REPORT (${new Date().toISOString()})`,
        "CRITICAL FAILURE:",
        `Error: ${e instanceof Error ? e.message : String(e)}`,
      ].join("\n")
    );
    return NextResponse.json(
      { error: "Internal server error during reminder process" },
      { status: 500 }
    );
  }
}
