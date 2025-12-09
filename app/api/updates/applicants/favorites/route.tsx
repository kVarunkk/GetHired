import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Resend } from "resend";
import { render } from "@react-email/render";
import { headers } from "next/headers";
import { sendEmailForStatusUpdate } from "@/lib/serverUtils";
import FavoriteJobReminderEmail from "@/emails/FavoriteJobStatusReminderEmail";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DAYS_AGO = 7;

// FIX: Initialize Resend instance here
const resend = new Resend(RESEND_API_KEY);

export interface FavoritedJob {
  id: string;
  job_name: string;
  company_name: string;
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
    console.error("CRON Unauthorized Access Attempt: Secret Mismatch");
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  const serviceSupabase = createServiceRoleClient();
  const sevenDaysAgo = new Date(
    Date.now() - DAYS_AGO * 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    // 2. Fetch all favorited jobs in the last 7 days, along with application status

    const { data: favorites, error: fetchError } = await serviceSupabase
      .from("user_favorites")
      .select(
        `
                id, created_at, user_id, job_id,
                user_info ( email, full_name, user_id ),
                all_jobs (id, job_name, company_name, job_url, locations, salary_range, job_type ) 
            `
      )
      .gte("created_at", sevenDaysAgo)
      .eq("user_info.is_promotion_active", true);
    if (fetchError) {
      throw new Error(
        `Database fetch failed: ${fetchError.message || "Unknown DB error"}`
      );
    }

    // 3. Fetch all application IDs for all users found in the favorites list (past 7 days)
    const userIds = Array.from(new Set(favorites.map((fav) => fav.user_id)));
    const { data: userApplications, error: appFetchError } =
      await serviceSupabase
        .from("applications")
        .select(`all_jobs_id, applicant_user_id`)
        .gte("created_at", sevenDaysAgo)
        .in("applicant_user_id", userIds);

    if (appFetchError) {
      throw new Error(
        `Database fetch failed during application lookup: ${appFetchError.message}`
      );
    }

    const appliedJobsSet = new Set<string>();
    userApplications?.forEach((app) => {
      if (app.all_jobs_id && app.applicant_user_id) {
        appliedJobsSet.add(`${app.applicant_user_id}-${app.all_jobs_id}`);
      }
    });

    // 4. Aggregate and Filter: Group by user and exclude jobs that already have an application
    const usersToRemind = new Map<string, FavoritedJob[]>();
    const userDetailMap = new Map<
      string,
      { email: string; fullName: string }
    >();

    favorites.forEach((fav) => {
      const userId = fav.user_id;
      const jobId = fav.job_id;

      const job = fav.all_jobs as unknown as FavoritedJob;
      const userInfo = fav.user_info as unknown as {
        email: string;
        full_name: string;
        user_id: string;
      };
      // CRITICAL FILTER: Check if the user has applied to this specific job ID
      if (appliedJobsSet.has(`${userId}-${jobId}`)) {
        return;
      }

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
          job_url: job.job_url,
          job_type: job.job_type,
          locations: job.locations,
          salary_range: job.salary_range,
        });
      }
    });

    const totalUsers = usersToRemind.size;

    // --- 5. Final Exit Check (If no users were found after filtering) ---
    if (totalUsers === 0) {
      const report = [
        `Reminder Job Execution Report (${new Date().toISOString()})`,
        "Total Unique Users Targeted: 0",
        "No unapplied favorite jobs found.",
      ].join("\n");
      await sendEmailForStatusUpdate(report);
      return NextResponse.json({
        success: true,
        message: "No unapplied favorite jobs found to remind users about.",
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
          <FavoriteJobReminderEmail userName={userName} favoritedJobs={jobs} />
        );

        return resend.emails
          .send({
            from: "GetHired <varun@devhub.co.in>",
            to: [email],
            subject: `Reminder: Your ${jobs.length} Saved Jobs Are Waiting.`,
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
      `FAVORITED JOB APPLICATION REMINDER:`,
      `Total Users Targeted: ${totalUsers}`,
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
      message: `Processed reminders for ${totalUsers} users. Sent ${totalSuccessful} emails.`,
    });
  } catch (e) {
    console.error("Critical processing error:", e);
    await sendEmailForStatusUpdate(
      [
        `FAVORITED JOB APPLICATION REMINDER:`,
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
