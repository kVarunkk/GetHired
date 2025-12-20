import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Resend } from "resend";
import { render } from "@react-email/render";
import { headers } from "next/headers";
import { sendEmailForStatusUpdate } from "@/lib/serverUtils";
import FavoriteJobReminderEmail from "@/emails/FavoriteJobStatusReminderEmail";
import React from "react";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DAYS_AGO = 7;

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

  if (cronSecret !== INTERNAL_API_SECRET) {
    console.error("CRON Unauthorized Access Attempt: Secret Mismatch");
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  const serviceSupabase = createServiceRoleClient();
  const sevenDaysAgo = new Date(
    Date.now() - DAYS_AGO * 24 * 60 * 60 * 1000
  ).toISOString();

  try {
    // Fetch all favorited jobs in the last 7 days, along with application status
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

    // Fetch all application IDs for all users found in the favorites list (past 7 days)
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

    // Aggregate and Filter: Group by user and exclude jobs that already have an application
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

    const processReminders = async () => {
      const userEntries = Array.from(usersToRemind.entries());
      const results: { email: string; success: boolean; error?: string }[] = [];
      const BATCH_SIZE = 5;

      for (let i = 0; i < userEntries.length; i += BATCH_SIZE) {
        const batch = userEntries.slice(i, i + BATCH_SIZE);

        const batchPromises = batch.map(async ([userId, jobs]) => {
          const user = userDetailMap.get(userId);
          if (!user?.email) return;

          try {
            const emailHtml = await render(
              React.createElement(FavoriteJobReminderEmail, {
                userName: user.fullName,
                favoritedJobs: jobs,
              })
            );

            await resend.emails.send({
              from: "GetHired <varun@devhub.co.in>",
              to: [user.email],
              subject: `Reminder: Your ${jobs.length} Saved Jobs Are Waiting.`,
              html: emailHtml,
            });
            results.push({ email: user.email, success: true });
          } catch (err: unknown) {
            results.push({
              email: user.email,
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });

        await Promise.allSettled(batchPromises);
      }

      // Final Admin Report
      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success);
      const report = [
        `FAVORITE REMINDER REPORT (${new Date().toLocaleString()})`,
        `Users Targeted: ${totalUsers}`,
        `Successful: ${successful}`,
        `Failed: ${failed.length}`,
        ...(failed.length > 0
          ? ["FAILED:", ...failed.map((f) => `- ${f.email}: ${f.error}`)]
          : []),
      ].join("\n");

      await sendEmailForStatusUpdate(report);
    };

    processReminders();

    return NextResponse.json({
      success: true,
      message: `Background processing started for ${totalUsers} users.`,
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
