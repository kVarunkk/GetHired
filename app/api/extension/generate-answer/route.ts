import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { TAICredits, TResumeRowContent } from "@/utils/types";
import { extractSectionText } from "@/utils/extract-resume-content";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ message: "Missing token" }, { status: 401 });
    }

    const supabase = createServiceRoleClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ message: "Invalid session" }, { status: 401 });
    }

    const {
      questions,
      jobContext,
    }: { questions: string[]; jobContext?: string } = await request.json();

    if (!Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json(
        { message: "questions array required" },
        { status: 400 },
      );
    }

    const { data: userInfo, error: userInfoError } = await supabase
      .from("user_info")
      .select(
        "desired_roles, experience_years, top_skills, career_goals_short_term, career_goals_long_term, ai_credits, resumes(content, is_primary)",
      )
      .eq("user_id", user.id)
      .eq("resumes.is_primary", true)
      .single();

    if (userInfoError || !userInfo) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    const availableCredits = userInfo.ai_credits ?? 0;
    const answerCount = Math.min(questions.length, availableCredits);

    const answers: Record<string, string> = {};

    if (answerCount <= 0) {
      return NextResponse.json(
        {
          answers: {},
          message: "Out of AI credits",
          code: "NO_CREDITS",
        },
        { status: 402 },
      );
    }

    const resumeContent = userInfo.resumes?.[0]?.content as TResumeRowContent;
    const { experience, skills, projects } = extractSectionText(
      ["experience", "skills", "projects"],
      resumeContent,
    );

    const model = google("gemini-3.1-flash-lite");

    const promises = questions.slice(0, answerCount).map(async (question) => {
      const prompt = `
You are helping a job applicant answer a job application question.
Write a concise, specific, first-person answer. Do not invent facts not supported by the candidate's background below. Keep it under 150 words unless the question clearly asks for more detail.

**Candidate background:**
- Desired Roles: ${userInfo.desired_roles?.join(", ") ?? "N/A"}
- Years of Experience: ${userInfo.experience_years ?? "N/A"}
- Skills: ${[skills, userInfo.top_skills?.join(", ")].filter(Boolean).join(", ")}
- Experience: ${experience}
- Projects: ${projects}
- Career Goals: ${userInfo.career_goals_short_term ?? ""} ${userInfo.career_goals_long_term ?? ""}

**Job context:**
${jobContext?.slice(0, 4000) ?? "Not available"}

**Question:**
${question}

Respond with only the answer text, no preamble, no quotation marks.
      `.trim();

      const { text } = await generateText({ model, prompt });
      return { question, answer: text.trim() };
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      answers[r.question] = r.answer;
    }

    await deductUserCreditsHelper(
      supabase,
      user.id,
      TAICredits.AI_SEARCH_ASK_AI_RESUME * answerCount,
    );

    return NextResponse.json({ answers });
  } catch (err) {
    console.error("[generate-answer] failed", err);
    return NextResponse.json({ message: "An error occurred" }, { status: 500 });
  }
}
