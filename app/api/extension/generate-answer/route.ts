import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { TAICredits, TResumeRowContent } from "@/utils/types";
import { extractSectionText } from "@/utils/extract-resume-content";

/** Enforces the formatting rules even when the model ignores the prompt:
 * no em/en dashes and no markdown, since answers go into plain text boxes. */
function toPlainAnswer(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2") // ranges like 2019–2021
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|[.,!?]|$)/gm, "$1$2") // italics
    .replace(/^\s*(?:[*\-•]|\d+[.)])\s+/gm, "") // list markers
    .replace(/^#+\s*/gm, "") // headings
    .replace(/,\s*([.,!?])/g, "$1") // stray comma left before punctuation
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
You are writing as a job applicant, answering a question on a job application form in their own voice.

How the answer should read:
- Write like a real person typing into a form: first person, conversational but professional, the way a thoughtful candidate would actually phrase it. It should not sound like AI wrote it.
- Answer the question that was asked, directly. Lead with the point, not a restatement of the question.
- Pick the one or two most relevant details from the background instead of listing everything. Mention specific projects, numbers or outcomes only when they actually support the answer.
- Vary sentence length. Use plain, everyday words.
- Avoid stock phrases like "I am excited to", "I am passionate about", "leverage", "utilize", "spearhead", "cutting-edge", "showcase", "demonstrating my expertise", "in today's fast-paced world".
- Keep it under 120 words unless the question clearly asks for more. Short questions get short answers, even one sentence.
- When the job context names the company or describes the role, connect the answer to something specific from it (what the company builds, a responsibility or requirement of the role) and how the candidate's background fits. Don't just drop the company name in, and don't copy sentences from the job description.

Formatting rules (strict):
- Plain text only. The answer is pasted into a plain text box, so no markdown: no bullet points, numbered lists, headings, bold, italics or asterisks.
- Never use em dashes or en dashes. Use commas, periods or separate sentences instead.
- Write in one or two short paragraphs.

Accuracy rules (strict):
- Only use facts from the candidate background below. Never invent names, links, usernames, numbers, employers or projects.
- If the question asks for a link or detail the background doesn't contain, say briefly that you're happy to share it, rather than making one up.

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
      return { question, answer: toPlainAnswer(text) };
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
