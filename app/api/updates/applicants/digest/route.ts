import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getAllDigestUsers, sendJobDigestEmail } from "@/lib/digest-utils";
import { IFormData, IJob } from "@/lib/types";
import { getCutOffDate, sendEmailForStatusUpdate } from "@/lib/serverUtils";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

const productionUrl = "https://gethired.devhub.co.in";
const URL =
  process.env.NODE_ENV === "production"
    ? productionUrl
    : process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : "http://localhost:3000";

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
    const users = await getAllDigestUsers();
    const digestPromises = users.map((user) =>
      processUserDigest(user, digestDate)
    );

    const results = await Promise.all(digestPromises);

    const successSends: string[] = [];
    const failedSends: { email: string; reason: string }[] = [];

    results.forEach((res) => {
      if (res.success) {
        successSends.push(res.userEmail);
      } else {
        failedSends.push({
          email: res.userEmail,
          reason: res.error || "Processing failed",
        });
      }
    });

    const totalUsers = users.length;
    const totalSuccessful = successSends.length;

    // 7. Send Final Admin Report
    const report = [
      `DIGEST EXECUTION REPORT (${new Date().toISOString()})`,
      `Total Users Targeted: ${totalUsers}`,
      `Successful Sends: ${totalSuccessful}`,
      `Failed Sends: ${failedSends.length}`,
      "-------------------------------------------------------",
      `SUCCESSFUL EMAILS: ${successSends.join(", ")}`,
      "-------------------------------------------------------",
      `FAILED EMAILS:`,
      ...failedSends.map((f) => `- ${f.email}: ${f.reason}`),
    ].join("\n");

    await sendEmailForStatusUpdate(report);

    return NextResponse.json({
      success: true,
      message: `Processed ${totalUsers} users. Successful sends: ${totalSuccessful}.`,
    });
  } catch (error) {
    console.error("Global Job Digest Execution Failed:", error);
    await sendEmailForStatusUpdate(
      [
        `DIGEST EXECUTION REPORT (${new Date().toISOString()})`,
        "GLOBAL CRITICAL FAILURE:",
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      ].join("\n")
    );
    return NextResponse.json(
      {
        success: false,
        message: "Failed to process all job digests.",
      },
      { status: 500 }
    );
  }
}

/**
 * Core logic to fetch, rerank, and send jobs for a single user.
 */
async function processUserDigest(user: IFormData, digestDate: string) {
  try {
    const cutoffDate = getCutOffDate(30);

    const jobFetchRes = await fetch(
      `${URL}/api/jobs?sortBy=relevance&limit=100&createdAfter=${cutoffDate}&userId=${user.user_id}`,
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
    const initialJobs: IJob[] = result.data || [];

    // --- 3. AI Re-ranking (Step 2) ---
    let finalJobs: IJob[] = initialJobs;

    if (initialJobs.length > 0) {
      const aiRerankRes = await fetch(`${URL}/api/ai-search/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": INTERNAL_API_SECRET || "",
        },
        body: JSON.stringify({
          userId: user.user_id,
          jobs: initialJobs.map((job) => ({
            id: job.id,
            job_name: job.job_name,
            description: job.description,
            visa_requirement: job.visa_requirement,
            salary_range: job.salary_range,
            locations: job.locations,
            experience: job.experience,
          })),
        }),
      });

      if (!aiRerankRes.ok) {
        console.error(
          `AI Rerank API failed with status: ${aiRerankRes.status}`
        );

        const errorText = await aiRerankRes.text();
        console.error(
          "AI Rerank API error body:",
          errorText.substring(0, 500) + "..."
        );

        throw new Error(`AI Rerank API failed (Status: ${aiRerankRes.status})`);
      }

      const aiRerankResult: {
        rerankedJobs: string[];
        filteredOutJobs: string[];
      } = await aiRerankRes.json();

      if (aiRerankRes.ok && aiRerankResult.rerankedJobs) {
        const uniqueRerankedIds = Array.from(
          new Set(aiRerankResult.rerankedJobs)
        );
        const filteredOutIds: string[] = aiRerankResult.filteredOutJobs || [];

        const jobMap = new Map(initialJobs.map((job: IJob) => [job.id, job]));

        finalJobs = uniqueRerankedIds
          .map((id: string) => jobMap.get(id))
          .filter(
            (job: IJob | undefined) =>
              job !== undefined && !filteredOutIds.includes(job.id)
          ) as IJob[];
      }
    }

    // Fallback (If  AI search was too slow/skipped) ---

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
