import { after, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Resend } from "resend";
import { render } from "@react-email/render";
import { headers } from "next/headers";
import { deploymentUrl, sendEmailForStatusUpdate } from "@/lib/serverUtils";
import React from "react";
import BookmarkAlertEmail from "@/emails/BookmarkAlertEmail";
import { IJob } from "@/lib/types";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const productionUrl = "https://gethired.devhub.co.in";
const URL = deploymentUrl();

const DAYS_AGO = 7;

const resend = new Resend(RESEND_API_KEY);

export async function GET() {
  const headersList = await headers();
  const cronSecret = headersList.get("x-internal-secret");

  if (cronSecret !== INTERNAL_API_SECRET) {
    console.error("CRON Unauthorized Access Attempt: Secret Mismatch");
    return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
  }

  const serviceSupabase = createServiceRoleClient();

  try {
    const { data: bookmarks, error: fetchError } = await serviceSupabase
      .from("bookmarks")
      .select(
        `
                id, 
                created_at, 
                user_id, 
                url, 
                name,
                is_alert_on,
                user_info ( email, full_name )
            `
      )
      .eq("is_alert_on", true);

    if (fetchError) {
      throw new Error(
        `Database fetch failed: ${fetchError.message || "Unknown DB error"}`
      );
    }

    if (!bookmarks || bookmarks.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No active alerts to process.",
      });
    }

    const processAllAlerts = async () => {
      const results: {
        email: string;
        url: string;
        success: boolean;
        jobsFound: number;
        error?: string;
      }[] = [];
      // const cutoffDate = getCutOffDate(DAYS_AGO);

      const BATCH_SIZE = 5;
      for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
        const batch = bookmarks.slice(i, i + BATCH_SIZE);

        const batchPromises = batch.map(async (bookmark) => {
          const userInfo = bookmark.user_info as unknown as {
            full_name?: string;
            email: string;
          };
          if (!userInfo?.email) return;

          try {
            const separator = bookmark.url.includes("?") ? "&" : "?";
            const fullInternalPath = `${bookmark.url}${separator}userId=${bookmark.user_id}&createdAfter=${DAYS_AGO}&limit=10`;
            const internalApiUrl = `${URL}/api${fullInternalPath}`;

            const response = await fetch(internalApiUrl, {
              headers: { "x-internal-secret": INTERNAL_API_SECRET || "" },
            });

            if (!response.ok)
              throw new Error(`Internal API returned ${response.status}`);

            const result = await response.json();
            const newJobs: IJob[] = result.data || [];

            if (Array.isArray(newJobs) && newJobs.length > 0) {
              const emailHtml = await render(
                React.createElement(BookmarkAlertEmail, {
                  userName: userInfo.full_name || userInfo.email.split("@")[0],
                  bookmarkName: bookmark.name || "Your Saved Search",
                  jobs: newJobs,
                  bookmarkUrl: URL + bookmark.url,
                })
              );

              await resend.emails.send({
                from: "GetHired <varun@devhub.co.in>",
                to: [userInfo.email],
                subject: `Job Alert: ${newJobs.length} new matches for "${bookmark.name}"`,
                html: emailHtml,
              });

              results.push({
                email: userInfo.email,
                url: bookmark.url,
                success: true,
                jobsFound: newJobs.length,
              });
            } else {
              results.push({
                email: userInfo.email,
                url: bookmark.url,
                success: true,
                jobsFound: 0,
              });
            }
          } catch (err: unknown) {
            results.push({
              email: userInfo.email,
              url: bookmark.url,
              success: false,
              jobsFound: 0,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });

        // Wait for this small batch to finish before moving to the next
        await Promise.allSettled(batchPromises);
      }

      // --- Admin Report (Runs after all background tasks finish) ---
      const successfulAlerts = results.filter(
        (r) => r.success && r.jobsFound > 0
      ).length;
      const failedAlerts = results.filter((r) => !r.success);

      const report = [
        `JOB ALERT EXECUTION REPORT (${new Date().toLocaleString()})`,
        `Total Alerts Checked: ${results.length}`,
        `Emails Sent: ${successfulAlerts}`,
        `Technical Failures: ${failedAlerts.length}`,
        "-------------------------------------------------------",
        ...failedAlerts.map((f) => `- ${f.email} (${f.url}): ${f.error}`),
      ].join("\n");

      await sendEmailForStatusUpdate(report);
    };

    // Execute the background process without 'await'
    after(processAllAlerts);

    return NextResponse.json({
      success: true,
      message: `Job alert processing started for ${bookmarks.length} bookmarks. Results will be emailed to admin.`,
    });
  } catch (e) {
    console.error("Critical processing error:", e);
    const errorMsg = e instanceof Error ? e.message : String(e);
    await sendEmailForStatusUpdate(
      `CRITICAL FAILURE IN JOB ALERTS:\n${errorMsg}`
    );
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
