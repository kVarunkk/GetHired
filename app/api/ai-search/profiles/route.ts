import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getVertexClient } from "@/utils/serverUtils";
import { AiSearchProfileBody } from "@/utils/types/api.types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function POST(request: NextRequest) {
  try {
    const internalSecret = request.headers.get("X-Internal-Secret");
    const isInternalCall = internalSecret === process.env.INTERNAL_API_SECRET;

    const supabase = isInternalCall
      ? createServiceRoleClient()
      : await createClient();

    const { userId, jobId, profiles, companyId }: AiSearchProfileBody =
      await request.json();

    if (!userId || !profiles || !jobId || !companyId) {
      return NextResponse.json(
        {
          message: "Required fields are missing in the request body.",
        },
        { status: 400 },
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
      `,
      )
      .eq("id", jobId)
      .single();

    if (jobError || !jobPosting) {
      // console.error("Error fetching job posting:", jobError);
      return NextResponse.json(
        { message: "Job posting not found." },
        { status: 404 },
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
      ${profiles.map(
        (profile) => `
        ---
        - Desired Roles: ${profile.desired_roles?.join(", ")}
        - Work Experience: ${profile.resume_experience}
        - Preferred Locations: ${profile.preferred_locations?.join(", ")}
        - Preferred Industries: ${profile.industry_preferences?.join(", ")}
        - Skills: ${profile.resume_skills + profile.top_skills?.join(", ")}
        - Projects: ${profile.resume_projects}
        - Work Style: ${profile.work_style_preferences?.join(", ")}
        - Job Type: ${profile.job_type?.join(", ")}
        - Company Size: ${profile.company_size_preference}
        - Career Goals: ${profile.career_goals_short_term} and ${
          profile.career_goals_long_term
        }
        ---
      `,
      )}
      
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
              "The list of re-ranked user profile IDs from most to least relevant.",
            ),
          filtered_out_profile_ids: z
            .array(z.string())
            .describe(
              "The list of profile IDs that were filtered out as irrelevant.",
            ),
        }),
      }),
    });

    return NextResponse.json({
      rerankedProfiles: object.reranked_profile_ids,
      filteredOutProfiles: object.filtered_out_profile_ids,
    });
  } catch {
    return NextResponse.json(
      {
        message: "An error occurred",
      },
      { status: 500 },
    );
  }
}
