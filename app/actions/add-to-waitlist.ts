"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * SERVER ACTION: joinWaitlistAction
 * Handles public waitlist signups with basic spam protection.
 */
export async function joinWaitlistAction(formData: FormData) {
  const email = formData.get("email") as string;
  const honeypot = formData.get("full_name") as string; // Hidden field to catch bots
  const type = formData.get("type") as string;
  // 1. Basic Bot Protection
  if (honeypot) {
    return { success: true }; // Silently ignore bots
  }

  if (!email || !email.includes("@")) {
    return { error: "Please provide a valid email address." };
  }

  const supabase = await createClient();

  try {
    const { error } = await supabase.from("waitlist").insert({
      email: email.toLowerCase().trim(),
      type: type,
    });

    if (error) {
      // Handle Unique Constraint (already joined)
      if (error.code === "23505") {
        return { success: true, message: "You're already on the list!" };
      }
      throw error;
    }

    return { success: true, message: "Welcome to the waitlist!" };
  } catch {
    // console.error("[WAITLIST_ERROR]:", err.message);
    return { error: "Something went wrong. Please try again." };
  }
}
