import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { IFormData, TAICredits } from "@/lib/types";
import { getVertexClient } from "@/lib/serverUtils";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { userId, job_post_id, profiles, companyId } = await request.json();

    if (!userId || !profiles || !job_post_id || !companyId) {
      return NextResponse.json(
        {
          message: "Required fields are missing in the request body.",
        },
        { status: 400 }
      );
    }

    const { data: companyInfo } = await supabase
      .from("company_info")
      .select("ai_credits")
      .eq("id", companyId)
      .single();

    if (!companyInfo) {
      return NextResponse.json(
        {
          message: "Company not found.",
        },
        { status: 404 }
      );
    }

    if (companyInfo.ai_credits < TAICredits.AI_SEARCH_OR_ASK_AI) {
      return NextResponse.json(
        { message: "Insufficient AI credits. Please top up to continue." },
        { status: 402 }
      );
    }

    // Step 1: Fetch the job posting details to use as the AI's "query"
    const { data: jobPosting, error: jobError } = await supabase
      .from("job_postings")
      .select(
        `
        id,
        title,
        description,
        location,
        job_type,
        min_salary,
        max_salary,
        min_experience,
        max_experience,
        visa_sponsorship,
        min_equity,
        max_equity,
        questions
      `
      )
      .eq("id", job_post_id)
      .single();

    if (jobError || !jobPosting) {
      // console.error("Error fetching job posting:", jobError);
      return NextResponse.json(
        { message: "Job posting not found." },
        { status: 404 }
      );
    }

    const jobQuery = `
      Job Title: ${jobPosting.title}
      Job Description: ${jobPosting.description}
      Location: ${jobPosting.location?.join(", ")}
      Job Type: ${jobPosting.job_type}
      Experience Required: ${jobPosting.min_experience || 0}-${
        jobPosting.max_experience || "∞"
      } years
      Visa Sponsorship: ${jobPosting.visa_sponsorship}
      Salary: $${jobPosting.min_salary || "N/A"} - $${
        jobPosting.max_salary || "N/A"
      }
      Equity: ${jobPosting.min_equity || "N/A"}% - ${
        jobPosting.max_equity || "N/A"
      }%
      Custom Questions: ${jobPosting.questions?.join(" | ") || "None"}
    `;

    // Step 2: Call the AI with the augmented prompt
    const vertex = await getVertexClient();
    const model = vertex("gemini-2.5-flash-lite");

    const rerankPrompt = `
      You are an expert search re-ranker. Your task is to evaluate a set of user profiles
      against a Job Posting and re-rank them based on relevance.
      
      **Job Posting Requirements:**
      ${jobQuery}

      **User Profiles to Evaluate:**
      ${profiles
        .map(
          (profile: IFormData) => `
        ---
        ID: ${profile.user_id}
        Name: ${profile.full_name}
        Desired Roles: ${profile.desired_roles?.join(", ")}
        Experience: ${profile.experience_years} years
        Preferred Locations: ${profile.preferred_locations?.join(", ")}
        Top Skills: ${profile.top_skills?.join(", ")}
        Work Style: ${profile.work_style_preferences?.join(", ")}
        ---
      `
        )
        .join("\n")}
      
      **Instructions:**
      1.  Read the job posting requirements carefully.
      2.  Analyze each user profile to determine its relevance to the job.
      3.  Re-rank the profile IDs from most relevant to least relevant.
      4.  Filter out any profiles that are completely irrelevant.
      5.  Output a JSON object with two keys: 'reranked_profile_ids' and 'filtered_out_profile_ids'. Do not include any other text.
    `;

    const { output: object } = await generateText({
      model: model,
      prompt: rerankPrompt,
      output: Output.object({
        schema: z.object({
          reranked_profile_ids: z
            .array(z.string())
            .describe(
              "The list of re-ranked user profile IDs from most to least relevant."
            ),
          filtered_out_profile_ids: z
            .array(z.string())
            .describe(
              "The list of profile IDs that were filtered out as irrelevant."
            ),
        }),
      }),
    });

    // Step 3: Increment AI search uses for the company

    const { error: companyInfoUpdateError } = await supabase
      .from("company_info")
      .update({
        ai_credits: companyInfo.ai_credits - TAICredits.AI_SEARCH_OR_ASK_AI,
      })
      .eq("id", companyId);

    if (companyInfoUpdateError) {
      throw companyInfoUpdateError;
    }

    return NextResponse.json({
      rerankedProfiles: object.reranked_profile_ids,
      filteredOutProfiles: object.filtered_out_profile_ids,
    });
  } catch {
    // console.error(e);
    return NextResponse.json(
      {
        message: "An error occurred",
      },
      { status: 500 }
    );
  }
}
