import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Resend } from "resend";
import { render } from "@react-email/render";
import ApplicationStatusReminderEmail from "@/emails/ApplicationStatusReminderEmail";
import { headers } from "next/headers";
import { sendEmailForStatusUpdate } from "@/lib/serverUtils";

const resend = new Resend(process.env.RESEND_API_KEY);
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const DAYS_AGO = 7;

export interface AppliedJob {
  id: string;
  job_name: string;
  company_name: string;
  application_date: string;
  locations: string[];
  job_type: string;
  salary_range: string;
  job_url?: string;
}

export async function GET() {
  const headersList = await headers();
  const cronSecret = headersList.get("x-internal-secret");

  // --- 1. Security Check ---
  if (cronSecret !== INTERNAL_API_SECRET) {
    // FIX: Use INTERNAL_API_SECRET for header check
    console.error("CRON Unauthorized Access Attempt: Secret Mismatch");
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  const serviceSupabase = createServiceRoleClient();
  const sevenDaysAgo = new Date(
    Date.now() - DAYS_AGO * 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    // 2. Fetch all unique users who applied to jobs in the last 7 days
    const { data: applications, error: fetchError } = await serviceSupabase
      .from("applications")
      .select(
        `
                id, created_at, status, 
                applicant_user_id,
                user_info ( email, full_name, user_id ), 
                all_jobs (id, job_name, company_name, locations, job_type, salary_range, job_url ) 
            `
      )
      .gte("created_at", sevenDaysAgo)
      .eq("status", "submitted")
      .eq("user_info.is_promotion_active", true);

    if (fetchError) {
      throw new Error(
        `Database fetch failed: ${fetchError.message || "Unknown DB error"}`
      );
    }

    // 3. Aggregate data by user (UserID -> [List of Applied Jobs] and User Detail Map)
    const usersToRemind = new Map<string, AppliedJob[]>();
    const userDetailMap = new Map<
      string,
      { email: string; fullName: string }
    >();

    applications.forEach((app) => {
      const userId = app.applicant_user_id;
      const job = app.all_jobs as unknown as AppliedJob;
      const userInfo = app.user_info as unknown as {
        email: string;
        full_name: string;
        user_id: string;
      }; // Fetched user info is now here

      // Populate the user detail map immediately (safer)
      if (userInfo && userInfo.email) {
        userDetailMap.set(userId, {
          email: userInfo.email,
          fullName: userInfo.full_name ?? userInfo.email.split("@")[0],
        });
      }

      if (job) {
        if (!usersToRemind.has(userId)) {
          usersToRemind.set(userId, []);
        }
        usersToRemind.get(userId)!.push({
          id: job.id,
          job_name: job.job_name,
          company_name: job.company_name,
          application_date: new Date(app.created_at).toLocaleDateString(),
          job_type: job.job_type,
          locations: job.locations,
          salary_range: job.salary_range,
          job_url: job.job_url,
        });
      }
    });

    const totalUsers = usersToRemind.size;

    // --- 4. Final Exit Check (If no users were found) ---
    if (totalUsers === 0) {
      const report = [
        `Reminder Job Execution Report (${new Date().toISOString()})`,
        "Total Unique Users Targeted: 0",
        "No applications found in the last 7 days.",
      ].join("\n");
      await sendEmailForStatusUpdate(report);
      return NextResponse.json({
        success: true,
        message: "No applications found to remind users about.",
      });
    }

    // 5. Send Emails and Collect Detailed Results
    const sendPromisesWithContext = Array.from(usersToRemind.entries()).map(
      async ([userId, jobs]) => {
        const userContext = userDetailMap.get(userId);
        const email = userContext?.email;
        const userName = userContext?.fullName || "Applicant";

        if (!email) {
          return Promise.reject({
            userId,
            email: "N/A",
            reason: "No email found in user_info",
          });
        }

        const emailHtml = await render(
          <ApplicationStatusReminderEmail
            userName={userName}
            appliedJobs={jobs}
          />
        );

        return resend.emails
          .send({
            from: "GetHired <varun@devhub.co.in>",
            to: [email],
            subject: `Reminder: Check the status of your ${jobs.length} recent applications`,
            html: emailHtml,
          })
          .then(() => ({ userId, email, status: "SUCCESS" }))
          .catch((err) => {
            return Promise.reject({
              userId,
              email,
              reason: err.message || "Unknown Resend Error",
            });
          });
      }
    );

    // 6. Execute all promises and analyze results
    const results = await Promise.allSettled(sendPromisesWithContext);

    const successfulSends: string[] = [];
    const failedSends: { email: string; reason: string }[] = [];

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        successfulSends.push(result.value.email);
      } else {
        const reason = result.reason;
        failedSends.push({
          email: reason.email || "Unknown",
          reason: reason.reason || "Promise rejected",
        });
      }
    });

    const totalSuccessful = successfulSends.length;

    // 7. Send Final Admin Report
    const report = [
      "JOB APPLICATION STATUS CHECK REMINDER: ",
      `Total Unique Users Targeted: ${totalUsers}`,
      `Successful Sends: ${totalSuccessful}`,
      `Failed Sends: ${failedSends.length}`,
      "-------------------------------------------------------",
      `SUCCESSFUL EMAILS: ${successfulSends.join(", ")}`,
      "-------------------------------------------------------",
      `FAILED EMAILS:`,
      ...failedSends.map((f) => `- ${f.email}: ${f.reason}`),
    ].join("\n");

    await sendEmailForStatusUpdate(report);

    return NextResponse.json({
      success: true,
      message: `Successfully processed reminders for ${totalUsers} users. Sent ${totalSuccessful} emails.`,
    });
  } catch (e) {
    console.error("Critical processing error:", e);
    // Ensure the error report is sent even on critical database failure
    await sendEmailForStatusUpdate(
      [
        "JOB APPLICATION STATUS CHECK REMINDER: ",
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
