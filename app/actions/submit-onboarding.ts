"use server";

import { deploymentUrl } from "@/lib/serverUtils";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { after } from "next/server";
import { TLimits } from "@/lib/types";
import { triggerRelevanceUpdate } from "./relevant-jobs-update";

export async function submitOnboardingAction(formData: FormData) {
  const supabase = await createClient();
  const headersList = await headers();

  const resumeId = formData.get("resumeId") as string | null;
  const resumeFile = formData.get("resumeFile") as File | null;
  const profileData = JSON.parse(formData.get("profileData") as string);
  const userId = profileData?.user_id;

  if (!userId) return { error: "User ID is required." };

  try {
    // 1. LIMIT CHECK: Prevent more than 5 resumes
    const { count, error: countError } = await supabase
      .from("resumes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) throw countError;

    // If uploading a NEW file, check if we're already at the limit
    if (resumeFile && resumeFile.size > 0 && (count || 0) >= TLimits.RESUME) {
      return {
        error:
          "Resume limit reached. Please remove an existing resume to upload a new one.",
      };
    }

    let finalResumeId = resumeId;
    let fileName = "";

    // 2. PRIMARY RESUME LOGIC (DATABASE ONLY)
    // We clear old primary flags before setting the new one
    await supabase
      .from("resumes")
      .update({ is_primary: false })
      .eq("user_id", userId);

    if (resumeFile && resumeFile.size > 0) {
      fileName = `resumes/${userId}/${Date.now()}-${resumeFile.name.replace(/\s+/g, "_")}`;

      const arrayBuffer = await resumeFile.arrayBuffer();
      const { error: storageError } = await supabase.storage
        .from("resumes")
        .upload(fileName, Buffer.from(arrayBuffer), {
          contentType: "application/pdf",
        });

      if (storageError) throw storageError;

      const { data: newResume, error: resError } = await supabase
        .from("resumes")
        .insert({
          user_id: userId,
          name: resumeFile.name,
          resume_path: fileName,
          is_primary: true,
          content: null,
        })
        .select("id")
        .single();

      if (resError) throw resError;
      finalResumeId = newResume.id;
    } else if (resumeId) {
      await supabase
        .from("resumes")
        .update({ is_primary: true })
        .eq("id", resumeId);
    }

    // 3. UPSERT PROFILE DATA
    const { error: userError } = await supabase.from("user_info").upsert(
      {
        ...profileData,
        // user_id: userId,
        // filled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (userError) throw userError;

    // 4. SEQUENTIAL BACKGROUND CHAIN
    after(async () => {
      const baseUrl = deploymentUrl();
      const internalHeaders = {
        "Content-Type": "application/json",
        Cookie: headersList.get("Cookie") || "",
      };

      try {
        // STEP A: If new file, Upload & Parse first
        if (resumeFile && resumeFile.size > 0) {
          // Call Parse API and WAIT for it to finish updating the 'content' column
          const parseRes = await fetch(`${baseUrl}/api/parse-resume`, {
            method: "POST",
            headers: internalHeaders,
            body: JSON.stringify({ userId, resumeId: finalResumeId }),
          });
          if (!parseRes.ok) throw new Error("Background Parse Failed");
        }

        // STEP B: Update Embedding (Reads the 'content' column we just filled)
        const embedRes = await fetch(
          `${baseUrl}/api/update-embedding/gemini/user`,
          {
            method: "POST",
            headers: internalHeaders,
            body: JSON.stringify(profileData),
          },
        );
        if (!embedRes.ok) throw new Error("Background Embedding Failed");

        // // STEP C: Relevant Jobs Update
        const relevanceUpdateRes = await triggerRelevanceUpdate(userId);

        if (relevanceUpdateRes.error) {
          throw new Error("Relevance job update failed");
        }

        console.log(
          `[ONBOARDING_CHAIN_SUCCESS]: Process complete for ${userId}`,
        );
      } catch (err) {
        console.error(
          "[ONBOARDING_CHAIN_FAILURE]:",
          err instanceof Error ? err.message : "Some error occured",
        );
      }
    });

    // revalidatePath("/dashboard");
    // revalidatePath("/jobs");

    return { success: true };
  } catch (err: unknown) {
    console.error("[ONBOARDING_SUBMIT_ERROR]:", err);
    return {
      error: err instanceof Error ? err.message : "Failed to save profile.",
    };
  }
}
