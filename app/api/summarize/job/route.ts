import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getVertexClient } from "@/lib/serverUtils";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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

  let jobDescription = "";

  try {
    const { data: job, error: fetchError } = await authenticatedSupabase
      .from("all_jobs")
      .select("description, job_name")
      .eq("id", job_id)
      .single();

    if (fetchError || !job || !job.description) {
      console.error(`Error fetching job ${job_id}:`, fetchError);
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
    const model = vertex("gemini-2.0-flash-lite-001");

    const { text: rawSummary } = await generateText({
      model: model,
      prompt: summaryPrompt,
    });

    const { error: updateError } = await serviceRoleSupbase
      .from("all_jobs")
      .update({ ai_summary: rawSummary })
      .eq("id", job_id);

    if (updateError) {
      console.error(`Error updating job ${job_id} with summary:`, updateError);
      return NextResponse.json(
        { error: "Failed to save summary to database." },
        { status: 500 }
      );
    }

    return NextResponse.json({ summary: rawSummary });
  } catch (e) {
    console.error("Critical error in job summarization process:", e);
    return NextResponse.json(
      { error: "Internal server processing failure." },
      { status: 500 }
    );
  }
}
