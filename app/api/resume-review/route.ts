import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getVertexClient } from "@/lib/serverUtils";
import { IResume, TAICredits } from "@/lib/types";

/**
 * API ROUTE: /api/resume/review
 * * CORE LOGIC:
 * 1. Validate the user's credit balance (requires 5 credits).
 * 2. Fetch the "Digital Twin" (parsed JSON) of the resume linked to this review.
 * 3. Use Gemini 2.5 Flash to perform a semantic "gap analysis" against the JD.
 * 4. Update the review record with the score and structured feedback.
 * 5. Deduct credits from the user's account.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();

  try {
    const { reviewId, targetJd, userId } = await req.json();

    if (!reviewId || !targetJd || !userId) {
      return NextResponse.json(
        { error: "Missing parameters" },
        { status: 400 },
      );
    }

    const { data: userInfo } = await supabase
      .from("user_info")
      .select("ai_credits")
      .eq("user_id", userId)
      .single();

    if (userInfo?.ai_credits < TAICredits.AI_CV_REVIEW) {
      return NextResponse.json(
        { error: "Insufficient AI credits. Please top up to continue." },
        { status: 402 },
      );
    }

    // 1. Fetch Resume Content (The Digital Twin)
    const { data: reviewData } = await supabase
      .from("resume_reviews")
      .select(`resume_id, resumes ( content )`)
      .eq("id", reviewId)
      .single();

    const resumeJson = (reviewData?.resumes as unknown as IResume)?.content;
    if (!resumeJson) {
      return NextResponse.json(
        { error: "Resume not indexed" },
        { status: 422 },
      );
    }

    // 2. AI Analysis with ID-Mapping
    const vertex = await getVertexClient();
    const model = vertex("gemini-2.5-flash-lite");

    const { output: analysis } = await generateText({
      model: model,
      system: `You are an expert Hiring Manager and Recruiter at a high-growth company. 
      Your task is to re-write resume bullet points to maximize the candidate's chances of an interview for the provided role.
      
      EVALUATION PARAMETERS:
      1. DOMAIN ALIGNMENT: Identify specific tools, frameworks, or methodologies in the JD (e.g., Redis/Kafka for tech, or CRM/SEO for non-tech) and ensure they are woven into the experience where honest.
      2. THE XYZ FORMULA: Accomplished [X] as measured by [Y], by doing [Z]. Every suggestion must include a quantitative metric (%, ms, $, count, or scale) even if you have to estimate a reasonable range based on the context.
      3. STRATEGIC DEPTH: Use high-level, impactful verbs (Architected, Orchestrated, Spearheaded, Optimized) instead of passive ones (Helped, Worked on, Built).
      4. NO GRAMMAR-ONLY FIXES: If a bullet point is already strong, skip it. Only suggest changes that significantly increase professional "weight" and relevance.
      
      SCORING RULES:
      - Return a 'score' out of 10.
      - 1-3: Major domain mismatch or zero metrics.
      - 4-7: Good background but lacks "scale" or "impact" stories.
      - 8-10: Highly tailored, metric-driven, and perfectly aligned with the JD requirements.`,
      prompt: `
        Analyze this Resume against the provided Job Description.
        
        JOB DESCRIPTION:
        ${targetJd}

        RESUME DIGITAL TWIN (JSON):
        ${JSON.stringify(resumeJson)}

        INSTRUCTIONS:
        - For every 'bullet_points' entry, you MUST provide the exact 'bullet_id' from the Resume JSON.
        - Ensure the 'suggested' text is punchy and authoritative.
      `,
      output: Output.object({
        schema: z.object({
          overall_feedback: z.string(),
          score: z.number(),
          bullet_points: z.array(
            z.object({
              bullet_id: z
                .string()
                .describe(
                  "The 'id' of the bullet point from the provided Resume JSON",
                ),
              section: z.string(),
              original: z.string(),
              suggested: z.string(),
              reason: z.string(),
              priority: z.enum(["high", "medium", "low"]),
            }),
          ),
        }),
      }),
    });

    // 3. Save Results
    await supabase
      .from("resume_reviews")
      .update({
        target_jd: targetJd,
        ai_response: analysis,
        score: analysis.score,
        status: "completed",
      })
      .eq("id", reviewId);

    await supabase.rpc("deduct_user_credits", {
      p_user_id: userId,
      p_amount: TAICredits.AI_CV_REVIEW,
    });

    return NextResponse.json({ success: true, analysis });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Some error occured" },
      { status: 500 },
    );
  }
}
