import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getVertexClient } from "@/lib/serverUtils";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TAICredits } from "@/lib/types";

const MAX_SUMMARY_LENGTH = 500;

export async function POST(req: Request) {
  const { job_id } = await req.json();

  if (!job_id) {
    return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
  }

  const authenticatedSupabase = await createClient();
  const serviceRoleSupbase = createServiceRoleClient();
  const {
    data: { user },
  } = await authenticatedSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }

  const { data, error } = await authenticatedSupabase
    .from("user_info")
    .select("ai_credits")
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }
  if (data.ai_credits < TAICredits.AI_SUMMARY) {
    return NextResponse.json(
      { error: "Insufficient AI credits. Please top up to continue." },
      { status: 402 }
    );
  }

  let jobDescription = "";

  try {
    const { data: job, error: fetchError } = await authenticatedSupabase
      .from("all_jobs")
      .select("description, job_name")
      .eq("id", job_id)
      .single();

    if (fetchError || !job || !job.description) {
      return NextResponse.json(
        { error: "Job description not found." },
        { status: 404 }
      );
    }
    jobDescription = job.description;

    const summaryPrompt = `You are a professional Career Advisor writing a snapshot summary for a job seeker. 
Your goal is to quickly convey the critical information in a highly readable, dense, single-paragraph format optimized for plain text display. 
The summary must be under ${MAX_SUMMARY_LENGTH} characters.

### Formatting Instructions:
1.  **Avoid numbered lists (1., 2., 3.).**
2.  **Start each section on a new line**
3.  **Use commas to separate skills/requirements.**
4.  **Start each section with a clear title.**

### Summary Structure:
Core Role: [Title/Level/Environment]
Focus: [2-3 Main Outcomes]
Skills: [3-4 Required Technologies/Tools]
Terms: [Experience required, Compensation, Contract Type, Location status].

Analyze the following job posting: "${job.job_name}". Text to summarize: ${jobDescription}`;
    const vertex = await getVertexClient();
    const model = vertex("gemini-2.5-flash-lite");

    const { text: rawSummary } = await generateText({
      model: model,
      prompt: summaryPrompt,
    });

    const { error: updateError } = await serviceRoleSupbase
      .from("all_jobs")
      .update({ ai_summary: rawSummary })
      .eq("id", job_id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to save summary to database." },
        { status: 500 }
      );
    }

    const { error: creditError } = await authenticatedSupabase
      .from("user_info")
      .update({ ai_credits: data.ai_credits - TAICredits.AI_SUMMARY })
      .eq("user_id", user.id);

    if (creditError) {
      throw creditError;
    }

    return NextResponse.json({ summary: rawSummary });
  } catch {
    return NextResponse.json(
      { error: "Internal server processing failure." },
      { status: 500 }
    );
  }
}
