"use server";

import { createClient } from "@/lib/supabase/server";
import { TAICredits } from "@/utils/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function submitOnboardingAction(formData: FormData) {
  const supabase = await createClient();
  const serviceRoleClient = createServiceRoleClient();

  const resumeId = formData.get("resumeId") as string | null;
  const resumeFile = formData.get("resumeFile") as File | null;
  const profileData = JSON.parse(formData.get("profileData") as string);
  const userId = profileData?.user_id;

  if (!userId) return { error: "User ID is required." };

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

  if (
    (profile.ai_credits || 0) < TAICredits.AI_SEARCH_ASK_AI_RESUME &&
    resumeFile
  ) {
    return {
      error: `Insufficient AI credits for resume upload. Please top up to continue.`,
    };
  }

  try {
    let finalResumeId = resumeId;
    let fileName = "";

    // 2. PRIMARY RESUME LOGIC (DATABASE ONLY)
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (userError) throw userError;

    // 4. Enqueue message
    const { error: queueError } = await serviceRoleClient
      .schema("pgmq_public")
      .rpc("send", {
        queue_name: "onboarding_pipeline",
        message: {
          userId: userId,
          resumeId: finalResumeId,
          shouldParse: !!(resumeFile && resumeFile.size > 0),
        },
      });

    if (queueError) throw queueError;

    return { success: true };
  } catch (err: unknown) {
    console.error("[ONBOARDING_SUBMIT_ERROR]:", err);
    return {
      error: err instanceof Error ? err.message : "Failed to save profile.",
    };
  }
}
