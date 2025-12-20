import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Resend } from "resend";
import { render } from "@react-email/render";
import ApplicationStatusReminderEmail from "@/emails/ApplicationStatusReminderEmail";
import { headers } from "next/headers";
import { sendEmailForStatusUpdate } from "@/lib/serverUtils";
import React from "react";

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

  if (cronSecret !== INTERNAL_API_SECRET) {
    console.error("CRON Unauthorized Access Attempt: Secret Mismatch");
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  const serviceSupabase = createServiceRoleClient();
  const sevenDaysAgo = new Date(
    Date.now() - DAYS_AGO * 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    // Fetch all unique users who applied to jobs in the last 7 days
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

    //  Aggregate data by user (UserID -> [List of Applied Jobs] and User Detail Map)
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
      };

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

    const processAllReminders = async () => {
      const userEntries = Array.from(usersToRemind.entries());
      const results: { email: string; success: boolean; error?: string }[] = [];
      const BATCH_SIZE = 5;

      console.log(
        `[BACKGROUND JOB] Starting status reminders for ${totalUsers} users.`
      );

      for (let i = 0; i < userEntries.length; i += BATCH_SIZE) {
        const batch = userEntries.slice(i, i + BATCH_SIZE);

        const batchPromises = batch.map(async ([userId, jobs]) => {
          const userContext = userDetailMap.get(userId);
          const email = userContext?.email;
          const userName = userContext?.fullName || "Applicant";

          if (!email) return;

          try {
            const emailHtml = await render(
              React.createElement(ApplicationStatusReminderEmail, {
                userName,
                appliedJobs: jobs,
              })
            );

            await resend.emails.send({
              from: "GetHired <varun@devhub.co.in>",
              to: [email],
              subject: `Reminder: Check the status of your ${jobs.length} recent applications`,
              html: emailHtml,
            });

            results.push({ email, success: true });
          } catch (err: unknown) {
            results.push({
              email: email || "Unknown",
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });

        await Promise.allSettled(batchPromises);
      }

      const successfulSends = results
        .filter((r) => r.success)
        .map((r) => r.email);
      const failedSends = results.filter((r) => !r.success);

      const report = [
        "JOB APPLICATION STATUS CHECK REMINDER:",
        `Total Users Targeted: ${totalUsers}`,
        `Successful Sends: ${successfulSends.length}`,
        `Failed Sends: ${failedSends.length}`,
        "-------------------------------------------------------",
        `SUCCESSFUL EMAILS: ${successfulSends.join(", ") || "None"}`,
        "-------------------------------------------------------",
        `FAILED EMAILS:`,
        ...failedSends.map((f) => `- ${f.email}: ${f.error}`),
      ].join("\n");

      await sendEmailForStatusUpdate(report);
      console.log(
        `[BACKGROUND JOB] Finished. Success: ${successfulSends.length}, Failed: ${failedSends.length}`
      );
    };

    processAllReminders();

    return NextResponse.json({
      success: true,
      message: `Background processing started for ${totalUsers} users. Results will be reported to admin.`,
    });
  } catch (e) {
    console.error("Critical processing error:", e);
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
