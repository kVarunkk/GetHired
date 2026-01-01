import { after, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAllDigestUsers, sendJobDigestEmail } from "@/lib/digest-utils";
import { IFormData, IJob } from "@/lib/types";
import { deploymentUrl, sendEmailForStatusUpdate } from "@/lib/serverUtils";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

const URL = deploymentUrl();

export async function GET() {
  const headersList = await headers();

  // --- 1. Security Check (CRITICAL) ---
  const cronSecret = headersList.get("X-Internal-Secret");
  if (cronSecret !== INTERNAL_API_SECRET) {
    return NextResponse.json(
      { message: "Unauthorized access to digest route" },
      { status: 401 }
    );
  }

  const digestDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  try {
    // 2. Fetch all users who have opted into the weekly digest
    const users = await getAllDigestUsers();

    if (!users || users.length === 0) {
      await sendEmailForStatusUpdate(
        "JOB DIGEST USER NOT FOUND. EXITING SUCCESFULLY."
      );
      return NextResponse.json({
        success: true,
        message: "No users found for digest today.",
      });
    }

    // --- 3. BACKGROUND EXECUTION (FIRE-AND-FORGET) ---

    const processAllDigests = async () => {
      const results: { userEmail: string; success: boolean; error?: string }[] =
        [];
      const BATCH_SIZE = 5;

      console.log(
        `[DIGEST JOB] Starting background processing for ${users.length} users.`
      );

      // Process users in batches to stay within rate limits and prevent CPU spikes
      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);

        const digestPromises = batch.map((user) =>
          processUserDigest(user, digestDate)
        );

        const batchResults = await Promise.allSettled(digestPromises);

        batchResults.forEach((res) => {
          if (res.status === "fulfilled") {
            results.push(res.value);
          } else {
            results.push({
              userEmail: "Unknown",
              success: false,
              error:
                res.reason instanceof Error
                  ? res.reason.message
                  : "Promise rejected",
            });
          }
        });
      }

      // --- 4. Final Admin Report (Runs after all background tasks finish) ---
      const successfulSends = results
        .filter((r) => r.success)
        .map((r) => r.userEmail);
      const failedSends = results.filter((r) => !r.success);

      const report = [
        `JOB DIGEST EXECUTION REPORT (${new Date().toLocaleString()})`,
        `Total Users Targeted: ${users.length}`,
        `Successful Emails: ${successfulSends.length}`,
        `Failed/Skipped: ${failedSends.length}`,
        "-------------------------------------------------------",
        `SUCCESSFUL: ${successfulSends.join(", ") || "None"}`,
        "-------------------------------------------------------",
        `FAILED/SKIPPED DETAILS:`,
        ...failedSends.map((f) => `- ${f.userEmail}: ${f.error}`),
      ].join("\n");

      await sendEmailForStatusUpdate(report);
      console.log(
        `[DIGEST JOB] Finished. Success: ${successfulSends.length}, Failed: ${failedSends.length}`
      );
    };

    after(processAllDigests);

    // Trigger the heavy background workload without 'await'
    // processAllDigests();

    // 5. Respond immediately to the Cron scheduler
    // This avoids the 5-10 second timeout from Supabase/Vercel
    return NextResponse.json({
      success: true,
      message: `Job digest processing started for ${users.length} users. Results will be emailed to admin.`,
    });
  } catch (error) {
    console.error("Global Job Digest Execution Failed:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);

    await sendEmailForStatusUpdate(
      [`JOB DIGEST CRITICAL FAILURE:`, `Error: ${errorMsg}`].join("\n")
    );

    return NextResponse.json(
      { success: false, message: "Failed to initialize digest process." },
      { status: 500 }
    );
  }
}

/**
 * Core logic to fetch, rerank, and send jobs for a single user.
 */
async function processUserDigest(user: IFormData, digestDate: string) {
  try {
    // const cutoffDate = getCutOffDate(30);
    const cutoffDays = "7";

    const jobFetchRes = await fetch(
      `${URL}/api/jobs?sortBy=relevance&limit=100&createdAfter=${cutoffDays}&userId=${user.user_id}`,
      {
        headers: {
          "X-Internal-Secret": INTERNAL_API_SECRET || "",
        },
      }
    );

    if (!jobFetchRes.ok) {
      throw new Error(
        `API jobs endpoint failed with status ${jobFetchRes.status}`
      );
    }

    const result = await jobFetchRes.json();
    const finalJobs: IJob[] = result.data || [];

    // --- 4. Send Email (Top 10 Jobs) ---
    const topJobs = finalJobs.slice(0, 10);

    if (topJobs.length > 0 && user.email && user.full_name) {
      const { success, error } = await sendJobDigestEmail(
        user.email,
        user.full_name,
        topJobs,
        digestDate
      );
      if (!success || error) {
        throw new Error(`Failed to send email: ${error}`);
      }
      console.log(`Sent digest to ${user.email} with ${topJobs.length} jobs.`);
      return { success: true, userEmail: user.email };
    } else {
      console.log(`Skipped digest for ${user?.email}: no suitable jobs found.`);
      return {
        success: false,
        userEmail: user.email,
        error: "No suitable jobs found",
      };
    }
  } catch (e) {
    console.error(`Error processing digest for user ${user?.email}:`, e);
    return {
      success: false,
      userEmail: user.email,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
