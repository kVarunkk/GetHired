"use server";

import { deploymentUrl } from "@/lib/serverUtils";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { TAICredits, TLimits } from "@/lib/types";

export async function createResumeReviewAction(formData: FormData) {
  const supabase = await createClient();
  const headersList = await headers();
  const userId = formData.get("userId") as string;
  const reviewName =
    (formData.get("name") as string) ||
    `Review ${new Date().toLocaleDateString()}`;
  const existingResumeId = formData.get("existingResumeId") as string;
  const file = formData.get("file") as File;
  const jobId = formData.get("jobId") as string;

  if (!userId) return { error: "User authentication required." };

  try {
    const { data: profile } = await supabase
      .from("user_info")
      .select("ai_credits, resumes(id)")
      .eq("user_id", userId)
      .single();

    if (!profile || (profile.ai_credits || 0) < 5) {
      return {
        error: `Insufficient AI credits (${TAICredits.AI_CV_REVIEW} required).`,
      };
    }

    let finalResumeId = existingResumeId;

    if (!finalResumeId && file && file.size > 0) {
      if (profile.resumes.length >= TLimits.RESUME) {
        return {
          error: `You can only create ${TLimits.RESUME} resumes in free plan.`,
        };
      }
      // Pre-calculate the path so we can insert the record before the upload completes
      const fileName = `resumes/${userId}/${Date.now()}-${file.name.replace(/\s+/g, "_")}`;

      const { data: resumeEntry, error: resumeError } = await supabase
        .from("resumes")
        .insert({
          user_id: userId,
          name: file.name,
          resume_path: fileName,
          content: null, // Digital twin will be populated by the async parser
        })
        .select("id")
        .single();

      if (resumeError) throw resumeError;
      finalResumeId = resumeEntry.id;

      // 3. ASYNC: Background Processing
      // This continues running even after the server action returns the result to the client.
      after(async () => {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // Background Storage Upload
          const { error: storageError } = await supabase.storage
            .from("resumes")
            .upload(fileName, buffer, { contentType: "application/pdf" });

          if (storageError) {
            console.error("[BACKGROUND_STORAGE_ERROR]:", storageError);
            return;
          }

          // Background AI Parse Trigger
          const baseUrl = deploymentUrl();
          const res = await fetch(`${baseUrl}/api/parse-resume`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: headersList.get("Cookie") || "",
            },
            body: JSON.stringify({
              userId,
              resumeId: finalResumeId,
              // resumePath: fileName
            }),
          });

          if (!res.ok) {
            throw new Error("Some error occured while parsing resume");
          }

          console.log(
            `[BACKGROUND_PROCESS_SUCCESS]: Resume ${finalResumeId} parsed.`
          );
        } catch (bgError) {
          console.error("[BACKGROUND_PROCESS_FATAL]:", bgError);
          await supabase
            .from("resumes")
            .update({
              parsing_failed: true,
              updated_at: new Date().toISOString(),
            })
            .eq("id", finalResumeId);
        }
      });
    }

    const { data: reviewEntry, error: reviewError } = await supabase
      .from("resume_reviews")
      .insert({
        user_id: userId,
        resume_id: finalResumeId ?? null,
        status: "draft",
        name: reviewName,
        job_id: jobId ?? null,
      })
      .select("id")
      .single();

    if (reviewError) throw reviewError;

    revalidatePath("/resume-review");

    return { success: true, reviewId: reviewEntry.id };
  } catch (err: unknown) {
    console.error("[CREATE_REVIEW_ACTION_ERROR]:", err);
    return {
      error:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
