import { SupabaseClient } from "@supabase/supabase-js";

/**
 * deductUserCreditsHelper
 * A reusable utility to perform the credit deduction via RPC.
 * This version accepts the supabase client as an argument, making it
 * compatible with both standard clients and Service Role clients used in background tasks.
 */
export async function deductUserCreditsHelper(
  supabase: SupabaseClient,
  userId: string,
  amount: number,
) {
  try {
    const { error } = await supabase.rpc("deduct_user_credits", {
      p_user_id: userId,
      p_amount: amount,
    });

    if (error) {
      // Check for the specific database exception raised in the SQL function
      if (error.message.includes("Insufficient credits")) {
        return {
          success: false,
          error: "INSUFFICIENT_CREDITS",
          message: "User does not have enough credits.",
        };
      }
      throw error;
    }

    return { success: true };
  } catch (err: any) {
    console.error("[CREDIT_HELPER_ERROR]:", err.message);
    return {
      success: false,
      error: "INTERNAL_ERROR",
      message: err.message,
    };
  }
}
