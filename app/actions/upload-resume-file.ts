"use server";

import { deploymentUrl } from "@/lib/serverUtils";
import { createClient } from "@/lib/supabase/server";
import { TLimits } from "@/lib/types";
import { after } from "next/server";

/**
 * SERVER ACTION: uploadResumeAction
 * Used when a user uploads a new resume from within an existing review workspace.
 * 1. Creates a 'resumes' table entry immediately.
 * 2. Returns the resumeId to the client.
 * 3. Handles Storage upload and Parse trigger in the background.
 */
export async function uploadResumeAction(formData: FormData) {
  const supabase = await createClient();

  const userId = formData.get("userId") as string;
  const file = formData.get("file") as File;

  if (!userId || !file) {
    return { error: "Missing required upload data." };
  }

  // 1. LIMIT CHECK: Prevent more than 5 resumes
  const { count, error: countError } = await supabase
    .from("resumes")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) throw countError;

  // If uploading a NEW file, check if we're already at the limit
  if ((count || 0) >= TLimits.RESUME) {
    return {
      error:
        "Resume limit reached. Please remove an existing resume to upload a new one.",
    };
  }

  try {
    // 1. Prepare Metadata
    const fileName = `resumes/${userId}/${Date.now()}-${file.name.replace(/\s+/g, "_")}`;

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
          .upload(fileName, buffer, { contentType: "application/pdf" });

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
            userId,
            resumeId: resumeEntry.id,
            // resumePath: fileName,
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
