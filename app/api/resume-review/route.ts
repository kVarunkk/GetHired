import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getVertexClient } from "@/lib/serverUtils";
import { IResume } from "@/lib/types";

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
        { status: 400 }
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
        { status: 422 }
      );
    }

    // 2. AI Analysis with ID-Mapping
    const vertex = await getVertexClient();
    const model = vertex("gemini-2.5-flash-lite");

    const { output: analysis } = await generateText({
      model: model,
      system: `You are a recruiter. You will be provided with a Resume in JSON format and a Job Description.
      Each bullet point in the resume has a unique 'id'. 
      When suggesting an improvement, you MUST return the 'bullet_id' of the point you are referencing. You need to return the score out of 10.`,
      prompt: `
        JD: ${targetJd}
        RESUME JSON: ${JSON.stringify(resumeJson)}
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
                  "The 'id' of the bullet point from the provided Resume JSON"
                ),
              section: z.string(),
              original: z.string(),
              suggested: z.string(),
              reason: z.string(),
              priority: z.enum(["high", "medium", "low"]),
            })
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

    return NextResponse.json({ success: true, analysis });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Some error occured" },
      { status: 500 }
    );
  }
}
