"use server";

import { deploymentUrl } from "@/utils/serverUtils";
import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";
import { TAICredits } from "@/utils/types";

/**
 * SERVER ACTION: uploadResumeAction
 * Used when a user uploads a new resume from within an existing review workspace.
 * 1. Creates a 'resumes' table entry immediately.
 * 2. Returns the resumeId to the client.
 * 3. Handles Storage upload and Parse trigger in the background.
 */
export async function uploadResumeAction(formData: FormData) {
  const supabase = await createClient();

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

  if (!userId || !file || file.size === 0) {
    return { error: "Missing required upload data." };
  }

  if (file.size > 2 * 1024 * 1024) {
    return { error: "File too large. Maximum allowed size is 2MB." };
  }

  if (file.type !== "application/pdf") {
    return { error: "Invalid file format. Only PDFs are accepted." };
  }

  try {
    // 1. Prepare Metadata
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `resumes/${userId}/${Date.now()}-${sanitizedName}`;

    // 2. Create DB entry immediately to get an ID
    const { data: resumeEntry, error: resumeError } = await supabase
      .from("resumes")
      .insert({
        user_id: userId,
        name: file.name,
        resume_path: fileName,
        content: null, // To be filled by background parser
      })
      .select("id")
      .single();

    if (resumeError) throw resumeError;

    // 3. Background Task: Upload & Trigger Parse
    after(async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Upload to storage
        const { error: storageError } = await supabase.storage
          .from("resumes")
          .upload(fileName, buffer, {
            contentType: "application/pdf",
          });

        if (storageError) {
          console.error("[BG_UPLOAD_ERROR]:", storageError);
          return;
        }

        // Trigger the parse API
        const baseUrl = deploymentUrl();
        await fetch(`${baseUrl}/api/parse-resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resumeId: resumeEntry.id,
          }),
        });
      } catch (err) {
        console.error("[BG_PROCESS_FAILED]:", err);
      }
    });

    // Return the ID instantly
    return { success: true, resumeId: resumeEntry.id };
  } catch (err: unknown) {
    // console.error("[UPLOAD_ACTION_ERROR]:", err);
    return {
      error: err instanceof Error ? err.message : "Failed to initiate upload.",
    };
  }
}
