"use server";

import { deploymentUrl } from "@/lib/serverUtils";
import { createClient } from "@/lib/supabase/server";
import { TLimits } from "@/lib/types";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";

export async function createResumeAction(formData: FormData) {
  const supabase = await createClient();
  const headersList = await headers();

  const userId = formData.get("userId") as string;
  const file = formData.get("file") as File;

  if (!userId || !file) {
    return { error: "User ID and File are required." };
  }

  try {
    // 1. LIMIT CHECK: Ensure user doesn't have more than 5 resumes
    const { count, error: countError } = await supabase
      .from("resumes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) throw countError;
    if (count !== null && count >= TLimits.RESUME) {
      return {
        error:
          "Resume limit reached. You can only store up to 5 resumes in your library.",
      };
    }

    // 2. PREPARE STORAGE PATH
    const fileName = `resumes/${userId}/${Date.now()}-${file.name.replace(/\s+/g, "_")}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Storage
    const { error: storageError } = await supabase.storage
      .from("resumes")
      .upload(fileName, buffer, { contentType: "application/pdf" });

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
    // This allows us to return the result to the UI immediately while the PDF is uploaded and parsed.
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
            userId,
            resumeId: resumeEntry.id,
            // resumePath: fileName
          }),
        });

        console.log(
          `[BG_SUCCESS]: Resume ${resumeEntry.id} processing initiated.`,
        );
      } catch (err) {
        console.error("[BG_FATAL_ERROR]:", err);
        // await supabase
        //   .from("resumes")
        //   .update({
        //     parsing_failed: true,
        //     updated_at: new Date().toISOString(),
        //   })
        //   .eq("id", resumeEntry.id);
      }
    });

    revalidatePath("/resume");
    return { success: true, resumeId: resumeEntry.id };
  } catch (err: unknown) {
    // console.error("[CREATE_RESUME_ACTION_ERROR]:", err);
    return {
      error:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
