"use server";

import { deploymentUrl } from "@/lib/serverUtils";
import { createClient } from "@/lib/supabase/server";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

const URL = deploymentUrl();

export async function triggerRelevanceUpdate(userId: string) {
  if (!userId) {
    return { success: false, error: "User ID is required" };
  }

  const supabase = await createClient();

  const url = `${URL}/api/updates/applicants/relevant-jobs?userId=${userId}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Internal-Secret": INTERNAL_API_SECRET || "",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.log(response);
      const errorData = await response.json();
      throw new Error(
        errorData.error || `API request failed with status ${response.status}`,
      );
    }

    const data = await response.json();
    return { success: true, message: data.message };
  } catch (error) {
    console.error("[Server Action] Failed to trigger relevance update:", error);
    await supabase
      .from("user_info")
      .update({
        is_relevant_job_update_failed: true,
      })
      .eq("user_id", userId);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
