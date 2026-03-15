import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createClient } from "@/lib/supabase/server";
import { getVertexClient } from "@/utils/serverUtils";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TAICredits } from "@/utils/types";

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
      { status: 401 },
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
      { status: 402 },
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
        { status: 404 },
      );
    }
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
      .eq("id", job_id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to save summary to database." },
        { status: 500 },
      );
    }

    await authenticatedSupabase.rpc("deduct_user_credits", {
      p_user_id: user.id,
      p_amount: TAICredits.AI_SUMMARY,
    });

    return NextResponse.json({ summary: rawSummary });
  } catch {
    return NextResponse.json(
      { error: "Internal server processing failure." },
      { status: 500 },
    );
  }
}
