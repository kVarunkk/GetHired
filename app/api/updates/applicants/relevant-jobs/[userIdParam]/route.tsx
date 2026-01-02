import { after, NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  deploymentUrl,
  sendEmailForRelevantJobsStatusUpdate,
  sendEmailForStatusUpdate,
} from "@/lib/serverUtils";
import { IJob, TAICredits } from "@/lib/types";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

const URL = deploymentUrl();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userIdParam: string }> }
) {
  const headersList = await headers();

  // --- 1. Security Check ---
  const cronSecret = headersList.get("X-Internal-Secret");
  if (cronSecret !== INTERNAL_API_SECRET) {
    return NextResponse.json(
      { message: "Unauthorized access" },
      { status: 401 }
    );
  }

  const supabase = createServiceRoleClient();

  const { userIdParam } = await params;

  try {
    if (userIdParam) {
      const singleUserTask = async () => {
        console.log(
          `[RELEVANCE UPDATE] Processing single user: ${userIdParam}`
        );

        let sendRelevantJobFeedUpdate = false;

        const { data } = await supabase
          .from("user_info")
          .select("is_relevant_jobs_generated, email, full_name")
          .eq("user_id", userIdParam);

        if (data && data.length > 0 && data[0].is_relevant_jobs_generated) {
          sendRelevantJobFeedUpdate = true;
        }

        const email = "(Onboarding)";
        const result = await processUserRelevance(userIdParam, email);

        if (!result.success) {
          await sendEmailForStatusUpdate(
            `[RELEVANCE UPDATE] Failed for ${userIdParam}: ${result.error}`
          );
          if (sendRelevantJobFeedUpdate && data && data.length > 0) {
            await sendEmailForRelevantJobsStatusUpdate(
              data[0].email,
              data[0].full_name,
              URL + "/jobs?sortBy=relevance"
            );
          }
        } else {
          await sendEmailForStatusUpdate(
            `[RELEVANCE UPDATE] Success for ${userIdParam}`
          );
        }
      };

      // Trigger background task using after()
      after(singleUserTask);

      return NextResponse.json({
        success: true,
        message: `Triggered background relevance update for user ${userIdParam}`,
      });
    }

    // --- 2. Fetch Active Users ---
    // We select user_id from user_info. You might want to filter by 'last_sign_in_at'
    // to avoid processing inactive users if your table grows large.
    const { data: users, error: userError } = await supabase
      .from("user_info")
      .select("user_id, email")
      .eq("filled", true)
      .gte("ai_credits", TAICredits.AI_SEARCH_OR_ASK_AI);
    if (userError || !users || users.length === 0) {
      await sendEmailForStatusUpdate(
        "RELEVANT JOBS CRON: No users found. Exiting."
      );
      return NextResponse.json({
        success: true,
        message: "No users found to update.",
      });
    }

    // --- 3. Background Execution ---
    const updateRelevantJobsTask = async () => {
      console.log(
        `[RELEVANCE CRON] Starting update for ${users.length} users.`
      );

      const results: { userEmail: string; success: boolean; error?: string }[] =
        [];
      const BATCH_SIZE = 5; // Low concurrency to protect your /api/jobs endpoint

      for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);

        const promises = batch.map((user) =>
          processUserRelevance(user.user_id, user.email || "Unknown")
        );

        const batchResults = await Promise.allSettled(promises);

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

        // Optional small delay between batches to be gentle on DB resources
        await new Promise((r) => setTimeout(r, 200));
      }

      // --- 4. Final Report ---
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      const report = [
        `RELEVANT JOBS UPDATE REPORT (${new Date().toLocaleString()})`,
        `Total Users Processed: ${users.length}`,
        `Success: ${successful.length}`,
        `SuccessFul Emails: ${successful.map((each) => each.userEmail)}`,
        `Failed: ${failed.length}`,
        `Failed Emails: ${failed.map((each) => each.userEmail)}`,
        "-------------------------------------------------------",
        `FAILURES:`,
        ...failed.map((f) => `- ${f.userEmail}: ${f.error}`),
      ].join("\n");

      await sendEmailForStatusUpdate(report);
      console.log(`[RELEVANCE CRON] Finished. Report sent.`);
    };

    // Trigger background task
    after(updateRelevantJobsTask);

    return NextResponse.json({
      success: true,
      message: `Started relevance update for ${users.length} users.`,
    });
  } catch (error) {
    console.error("Critical Failure in Relevant Jobs Cron:", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await sendEmailForStatusUpdate(
      `RELEVANT JOBS CRITICAL FAILURE:\n${errorMsg}`
    );
    return NextResponse.json(
      { success: false, message: "Internal Server Error" },
      { status: 500 }
    );
  }
}

/**
 * Worker function for a single user
 */
async function processUserRelevance(userId: string, userEmail: string) {
  const supabase = createServiceRoleClient();
  const headersList = await headers();

  try {
    const cutoffDays = "30";
    // 1. Fetch Fresh Relevant Jobs
    // We use your existing API to get the "Smart Search" results
    const response = await fetch(
      `${URL}/api/jobs?sortBy=relevance&limit=100&createdAfter=${cutoffDays}&userId=${userId}`,
      {
        headers: {
          "X-Internal-Secret": INTERNAL_API_SECRET || "",
          // Cookie: headersList.get("Cookie") || "",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Jobs API returned ${response.status}`);
    }

    const json = await response.json();
    const jobs: IJob[] = json.data || [];

    if (jobs.length === 0) {
      return { success: true, userEmail, message: "No relevant jobs found" };
    }

    // 2. Prepare Data for Insertion
    // Map jobs to the schema: { user_id, jobs_id, rank }
    const rowsToInsert = jobs.map((job, index) => ({
      user_id: userId,
      jobs_id: job.id, // Assuming 'jobs_id' is the column name in user_relevant_jobs
      relevance_rank: index + 1,
      // created_at & updated_at are handled by default/trigger or we can pass updated_at: new Date()
      updated_at: new Date().toISOString(),
    }));

    // 3. Sync Database (Delete Old -> Insert New)
    // We delete *only* if we successfully fetched new jobs to avoid wiping data on API error

    // Step A: Delete existing entries for this user
    const { error: deleteError } = await supabase
      .from("user_relevant_jobs")
      .delete()
      .eq("user_id", userId);

    if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`);

    // Step B: Insert the new ranked list
    const { error: insertError } = await supabase
      .from("user_relevant_jobs")
      .insert(rowsToInsert);

    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    await supabase
      .from("user_info")
      .update({
        is_relevant_jobs_generated: true,
      })
      .eq("user_id", userId);

    return { success: true, userEmail };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, userEmail, error: msg };
  }
}
