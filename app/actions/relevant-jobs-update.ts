"use server";

import { deploymentUrl } from "@/lib/serverUtils";
import { headers } from "next/headers";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

const URL = deploymentUrl();

export async function triggerRelevanceUpdate(userId: string) {
  if (!userId) {
    return { success: false, error: "User ID is required" };
  }

  const url = `${URL}/api/updates/applicants/relevant-jobs/${userId}`;

  const headersList = await headers();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Internal-Secret": INTERNAL_API_SECRET || "",
        "Content-Type": "application/json",
        Cookie: headersList.get("Cookie") || "",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData.error || `API request failed with status ${response.status}`
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
