"use server";

import { generateText } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getVertexClient } from "@/utils/vertex";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PostHogEvent, TAICredits } from "@/utils/types";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { revalidatePathAction } from "./revalidate-path";
import { revalidateCacheAction } from "./revalidate-tag";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";

const MAX_SUMMARY_LENGTH = 500;

export async function SummarizeJobAction(jobId: string) {
  try {
    if (!jobId) throw new Error("Job id not found.");

    const authenticatedSupabase = await createClient();
    const serviceRoleSupbase = createServiceRoleClient();
    const {
      data: { user },
    } = await authenticatedSupabase.auth.getUser();

    if (!user) throw new Error("Unauthenticated.");

    const { data, error } = await authenticatedSupabase
      .from("user_info")
      .select("ai_credits")
      .eq("user_id", user.id)
      .single();

    if (error || !data) throw new Error("User not found.");

    if (data.ai_credits < TAICredits.AI_SUMMARY)
      throw new Error("Insufficient AI credits. Please top up to continue.");

    let jobDescription = "";

    const { data: job, error: fetchError } = await authenticatedSupabase
      .from("all_jobs")
      .select("description, job_name")
      .eq("id", jobId)
      .single();

    if (fetchError || !job || !job.description)
      throw new Error("Job description not found.");

    jobDescription = job.description;

    const summaryPrompt = `
        You are an Expert Technical Recruiter. Your task is to extract the "Signal" from a Job Description and create a high-density, professional snapshot for a developer.
        
        ### FORMATTING RULES:
        1. **CRITICAL:** Total length must be under ${MAX_SUMMARY_LENGTH} characters.
        2. **NO INTRO:** Start immediately with "Core Role:". 
        3. **NO LISTS:** Use commas for items. Use exactly one new line between sections.
        4. **NO FLUFF:** Avoid generic phrases like "Exciting opportunity" or "Join our team."
        5. **MISSING DATA:** If a specific data point (like Salary) is missing, write "Not specified" or "N/A".
        
        ### SNAPSHOT STRUCTURE:
        Core Role: [Seniority] [Title] in [Industry/Environment]
        Focus: [Primary mission or top 2 outcomes of the role]
        Skills: [Top 4 required technologies or tools, comma-separated]
        Terms: [Exp Years], [Salary/Equity], [Work Type: Remote/Onsite/Hybrid], [Employment: Full-time/Contract]
        
        ### DATA:
        <job_title>${job.job_name}</job_title>
        
        <job_description>
        ${jobDescription}
        </job_description>
        
        ### FINAL INSTRUCTION:
        Generate the snapshot now. Output ONLY the four lines of text.
        `.trim();

    const vertex = await getVertexClient();
    const model = vertex("gemini-2.5-flash-lite");

    const { text: rawSummary } = await generateText({
      model: model,
      prompt: summaryPrompt,
    });

    const { error: updateError } = await serviceRoleSupbase
      .from("all_jobs")
      .update({ ai_summary: rawSummary })
      .eq("id", jobId);

    if (updateError) throw new Error("Failed to save summary to database.");

    await revalidateCacheAction(`job-${jobId}`);
    await revalidatePathAction(`/jobs/${jobId}`);

    await deductUserCreditsHelper(
      authenticatedSupabase,
      user.id,
      TAICredits.AI_SUMMARY,
    );

    await eventCaptureServer({
      event: PostHogEvent.AiSummarizerUsed,
      distinctId: user?.id,
    });

    return {
      success: true,
      summary: rawSummary,
    };
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "Some error occured while summarizing job description.",
    };
  }
}
