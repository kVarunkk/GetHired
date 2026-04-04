"use server";

import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { createClient } from "../../lib/supabase/server";
import { TAICredits } from "@/utils/types";

/**
 * deductCreditsAction
 * Server action to subtract credits for AI features.
 * Automatically identifies the current user via auth session.
 */
export async function deductCreditsForUserRelevantJobSearch() {
  const supabase = await createClient();

  // 1. Identify active user from session (Security First)
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      error: "UNAUTHORIZED",
      message: "Authentication required to perform this action.",
    };
  }

  try {
    /**
     * 2. Delegate to reusable helper
     * This ensures consistent error handling and RPC logic across
     * API routes and Server Actions.
     */
    const result = await deductUserCreditsHelper(
      supabase,
      user.id,
      TAICredits.AI_SEARCH_ASK_AI_RESUME, // Cost constant
    );

    return result;
  } catch {
    // console.error("[CREDIT_ACTION_CRITICAL_FAILURE]:", err.message);
    return {
      success: false,
      error: "INTERNAL_ERROR",
      message: "A technical error occurred while updating your credits.",
    };
  }
}
