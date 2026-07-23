"use server";

import { createClient } from "@/lib/supabase/server";
import { after } from "next/server";
import { TAICredits } from "@/utils/types";
import { revalidatePath } from "next/cache";
import { parseResume } from "@/helpers/resume/parse-resume";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

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
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `resumes/${userId}/${Date.now()}-${sanitizedName}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: storageError } = await supabase.storage
      .from("resumes")
      .upload(fileName, buffer, {
        contentType: "application/pdf",
      });

    if (storageError) throw storageError;

    const { data: resumeEntry, error: resumeError } = await supabase
      .from("resumes")
      .insert({
        user_id: userId,
        name: file.name,
        resume_path: fileName,
        content: null,
      })
      .select("id")
      .single();

    if (resumeError) throw resumeError;

    after(async () => {
      try {
        await parseResume(userId, resumeEntry.id);
      } catch (err) {
        await eventCaptureServerException({
          error: err,
          distinctId: userId,
          properties: { flow: "upload_resume_file_after_block" },
        });
      }
    });
    revalidatePath("/resume");
    return { success: true, resumeId: resumeEntry.id };
  } catch (err: unknown) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while initiating resume upload.";
    await eventCaptureServerException({
      error: err,
      distinctId: userId,
      properties: { flow: "upload_resume_file" },
    });

    return {
      error,
    };
  }
}
