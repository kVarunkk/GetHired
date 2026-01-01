import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateText } from "ai";
import { getVertexClient } from "@/lib/serverUtils";
import { TAICredits } from "@/lib/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ job_id: string }> }
) {
  const { job_id } = await params;
  const { userQuery } = await request.json();
  if (!userQuery) {
    return NextResponse.json({ error: "Missing userQuery" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 }
    );
  }
  const userId = user.id;

  let answer = "";

  try {
    const { data: jobData, error: jobFetchError } = await supabase
      .from("all_jobs")
      .select("description, job_name")
      .eq("id", job_id)
      .single();

    const { data: userProfile } = await supabase
      .from("user_info")
      .select(
        "desired_roles, skills_resume, experience_resume, projects_resume, experience_years, career_goals_short_term, career_goals_long_term, ai_credits"
      )
      .eq("user_id", userId)
      .single();

    if (!userProfile) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (userProfile?.ai_credits < TAICredits.AI_SEARCH_OR_ASK_AI) {
      return NextResponse.json(
        { error: "Insufficient AI credits. Please top up to continue." },
        { status: 402 }
      );
    }

    if (jobFetchError || !jobData || !jobData.description) {
      return NextResponse.json(
        { error: "Job description not found for context." },
        { status: 404 }
      );
    }

    const jobContext = jobData.description;
    const userContext = JSON.stringify(userProfile);

    const prompt = `You are a specialist Application Synthesis Engine. Your goal is to generate a comprehensive, polished, and ready-to-use answer for a job application or interview question.

        Analyze the Job Requirements and the Applicant's Profile below. Your response must be structured as a high-quality, professional essay/paragraph that the user can immediately copy-paste.

        **CRITICAL INSTRUCTION:** Your response must explicitly synthesize (or bridge) the user's provided skills and experience with the specific demands mentioned in the job description. Do not generate bullet points; generate a continuous, persuasive block of text.

        Job Title: "${jobData.job_name}"
        Job Context: ${jobContext}. 
        Applicant's Profile: ${userContext}.

        Applicant Question: ${userQuery}`;

    const vertex = await getVertexClient();
    const model = vertex("gemini-2.5-flash-lite");

    const { text } = await generateText({
      model: model,
      prompt: prompt,
    });
    answer = text;

    const { error: deductError } = await supabase
      .from("user_info")
      .update({
        ai_credits: userProfile.ai_credits - TAICredits.AI_SEARCH_OR_ASK_AI,
      })
      .eq("user_id", userId);

    if (deductError) {
      //   console.error("Error deducting AI credits:", deductError);
      throw deductError;
    }

    return NextResponse.json({ success: true, answer: answer });
  } catch (e) {
    console.error("Error processing AI question:", e);
    return NextResponse.json(
      { error: "Server processing failed. Try again." },
      { status: 500 }
    );
  }
}
