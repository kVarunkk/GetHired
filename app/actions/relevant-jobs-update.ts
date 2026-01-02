"use server";

import { deploymentUrl } from "@/lib/serverUtils";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

const URL = deploymentUrl();

export async function triggerRelevanceUpdate(userId: string) {
  if (!userId) {
    return { success: false, error: "User ID is required" };
  }

  const url = `${URL}/api/updates/applicants/relevant-jobs/${userId}`;

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
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `API request failed with status ${response.status}`
      );
    }

    const data = await response.json();
    return { success: true, message: data.message };
  } catch (error) {
    console.error("[Server Action] Failed to trigger relevance update:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
