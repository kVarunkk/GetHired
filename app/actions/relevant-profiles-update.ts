"use server";

import { deploymentUrl } from "@/utils/serverUtils";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

const URL = deploymentUrl();

export async function triggerJobPostingRelevanceUpdate(jobId: string) {
  if (!jobId) {
    return { success: false, error: "User ID is required" };
  }

  const supabase = await createClient();
  const headersList = await headers();

  const url = `${URL}/api/updates/company/relevant-profiles?jobPostingId=${jobId}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      // headers: {
      //   "X-Internal-Secret": INTERNAL_API_SECRET || "",
      //   "Content-Type": "application/json",
      // },
      headers: {
        "Content-Type": "application/json",
        Cookie: headersList.get("Cookie") || "",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData.error || `API request failed with status ${response.status}`,
      );
    }

    const data = await response.json();
    return { success: true, message: data.message };
  } catch (error) {
    console.error("[Server Action] Failed to trigger relevance update:", error);
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    await supabase
      .from("job_postings")
      .update({
        matching_error: errorMsg,
        matching_status: "failed",
        matched_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return {
      success: false,
      error: errorMsg,
    };
  }
}
