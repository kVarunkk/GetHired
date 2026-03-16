"use server";

import { createClient } from "@/lib/supabase/server";
import { TAICredits } from "@/utils/types";

/**
 * deductCreditsForUser
 * Atomicly subtracts AI credits using the PostgreSQL RPC function.
 * Handles the "Below 0" constraint error gracefully.
 */
export async function deductCreditsForUser(userId: string) {
  if (!userId) return { error: "User ID is required." };

  const supabase = await createClient();
  const cost = TAICredits.AI_SEARCH_ASK_AI_RESUME;

  try {
    /**
     * Use the RPC function 'deduct_user_credits' defined in your SQL.
     * This function is atomic and checks if (ai_credits >= p_amount)
     * before performing the subtraction.
     */
    const { error } = await supabase.rpc("deduct_user_credits", {
      p_user_id: userId,
      p_amount: cost,
    });

    if (error) {
      // Handle the specific 'Insufficient credits' exception from Postgres
      if (error.message.includes("Insufficient credits")) {
        return {
          success: false,
          error: "INSUFFICIENT_CREDITS",
          message: "You do not have enough AI credits to perform this action.",
        };
      }

      // Handle other database errors
      throw error;
    }

    return { success: true };
  } catch {
    // console.error("[CREDIT_DEDUCTION_SYSTEM_ERROR]:", (err as Error).message);
    return {
      success: false,
      error: "INTERNAL_ERROR",
      message: "A technical error occurred while updating your credits.",
    };
  }
}
