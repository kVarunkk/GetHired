"use server";

import { deploymentUrl } from "@/utils/serverUtils";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";
import { TAICredits } from "@/utils/types";

export async function createResumeAction(formData: FormData) {
  const supabase = await createClient();
  const headersList = await headers();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: "Authentication required." };
  }

  const userId = user.id;

  const { data: profile } = await supabase
    .from("user_info")
    .select("ai_credits")
    .eq("user_id", userId)
    .single();

  if (!profile) {
    return {
      error:
        "User profile not found. Please complete your profile to upload a resume.",
    };
  }

  if ((profile.ai_credits || 0) < TAICredits.AI_SEARCH_ASK_AI_RESUME) {
    return {
      error: `Insufficient AI credits for resume upload. Please top up to continue.`,
    };
  }

  const file = formData.get("file") as File;

  if (!userId || !file) {
    return { error: "User ID and File are required." };
  }

  try {
    // 2. PREPARE STORAGE PATH
    const fileName = `resumes/${userId}/${Date.now()}-${file.name.replace(/\s+/g, "_")}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: storageError } = await supabase.storage
      .from("resumes")
      .upload(fileName, buffer, {
        contentType: "application/pdf",
      });

    if (storageError) throw storageError;

    // 3. CREATE DATABASE RECORD (Status: Processing/Syncing)
    const { data: resumeEntry, error: insertError } = await supabase
      .from("resumes")
      .insert({
        user_id: userId,
        name: file.name,
        resume_path: fileName,
        content: null, // Initially null, will be updated by background parser
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    // 4. BACKGROUND PROCESSING
    after(async () => {
      try {
        // Trigger AI Parsing (Relay Race pattern)
        const baseUrl = deploymentUrl();
        await fetch(`${baseUrl}/api/parse-resume`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: headersList.get("Cookie") || "",
          },
          body: JSON.stringify({
            resumeId: resumeEntry.id,
          }),
        });

        console.log(
          `[BG_SUCCESS]: Resume ${resumeEntry.id} processing initiated.`,
        );
      } catch (err) {
        console.error("[BG_FATAL_ERROR]:", err);
      }
    });

    revalidatePath("/resume");
    return { success: true, resumeId: resumeEntry.id };
  } catch (err: unknown) {
    return {
      error:
        err instanceof Error
          ? err.message
          : "An unexpected error occurred. Please try again later.",
    };
  }
}
