import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { IJob, TAICredits } from "@/lib/types";
import { getVertexClient } from "@/lib/serverUtils";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function POST(request: NextRequest) {
  try {
    const internalSecret = request.headers.get("X-Internal-Secret");
    const isInternalCall = internalSecret === process.env.INTERNAL_API_SECRET;

    // Choose the client based on the header
    const supabase = isInternalCall
      ? createServiceRoleClient() // No session needed, bypasses RLS
      : await createClient();

    const { userId, jobs } = await request.json();

    if (!userId || !jobs) {
      return NextResponse.json(
        {
          message: "user_id and jobs are required in the request body.",
        },
        { status: 400 }
      );
    }

    // Step 1: Fetch user preferences from the database
    const { data } = await supabase
      .from("user_info")
      .select(
        "desired_roles, experience_years, preferred_locations, min_salary, max_salary, top_skills, company_size_preference, career_goals_short_term, career_goals_long_term, visa_sponsorship_required, work_style_preferences, ai_credits, job_type, experience_resume, skills_resume, projects_resume"
      )
      .eq("user_id", userId)
      .single();
    const userPreferences = data;

    if (!userPreferences) {
      return NextResponse.json(
        {
          message: "User not found.",
        },
        { status: 404 }
      );
    }

    // if (userPreferences.ai_credits < TAICredits.AI_SEARCH_OR_ASK_AI) {
    //   return NextResponse.json(
    //     { message: "Insufficient AI credits. Please top up to continue." },
    //     { status: 402 }
    //   );
    // }

    // Step 2: Construct the userQuery based on fetched preferences
    const userQuery = `
      User is a candidate with the following preferences:
      - Desired Roles: ${userPreferences.desired_roles?.join(", ")}
      - Work Experience: ${userPreferences.experience_resume}
      - Skills: ${userPreferences.skills_resume + userPreferences.top_skills?.join(", ")}
      - Projects: ${userPreferences.projects_resume}
      - Years of Experience: ${userPreferences.experience_years} 
      - Preferred Locations: ${userPreferences.preferred_locations?.join(", ")}
      - Salary Range: $${userPreferences.min_salary} - $${
        userPreferences.max_salary
      }
      - Work Style: ${userPreferences.work_style_preferences?.join(", ")}
      - Job Type: ${userPreferences.job_type?.join(", ")}
      - Company Size: ${userPreferences.company_size_preference}
      - Career Goals: ${userPreferences.career_goals_short_term} and ${
        userPreferences.career_goals_long_term
      }
      - Visa Sponsorship: ${
        userPreferences.visa_sponsorship_required ? "Yes" : "No"
      }
      
      Please re-rank the job listings to find the best possible match for this candidate.
    `;

    // Step 3: Call the AI with the augmented prompt
    const vertex = await getVertexClient();
    const model = vertex("gemini-2.5-flash-lite");

    const rerankPrompt = `
      You are an expert search re-ranker. Your task is to evaluate a set of job listings
      against a user's query and re-rank them based on relevance, skills required,
      and experience level. You must only use the information provided for the jobs.
      
      **User Query:**
      ${userQuery}

      **Job Listings to Evaluate:**
      ${jobs
        .map(
          (job: IJob) => `
        ---
        ID: ${job.id}
        Title: ${job.job_name}
        Description: ${job.description}
        Experience: ${job.experience}
        Visa Requirement: ${job.visa_requirement}
        Salary Range: ${job.salary_range}
        Locations: ${job.locations}
        ---
      `
        )
        .join("\n")}
      
      **Instructions:**
      1.  Read the user's query carefully.
      2.  Analyze each job listing to determine its relevance to the query.
      3.  Re-rank the job IDs from most relevant to least relevant.
      4.  Filter out any jobs that are completely irrelevant or do not match the user's core intent.
      5.  Output a JSON array of the re-ranked job IDs. Do not include any other text.
    `;

    const { output: object } = await generateText({
      model: model,
      prompt: rerankPrompt,
      output: Output.object({
        schema: z.object({
          reranked_job_ids: z
            .array(z.string())
            .describe(
              "The list of re-ranked job IDs from most to least relevant."
            ),
          filtered_out_job_ids: z
            .array(z.string())
            .describe(
              "The list of job IDs that were filtered out as irrelevant."
            ),
        }),
      }),
    });

    if (!isInternalCall) {
      await supabase
        .from("user_info")
        .update({
          ai_credits:
            userPreferences.ai_credits - TAICredits.AI_SEARCH_OR_ASK_AI,
        })
        .eq("user_id", userId);
    }

    return NextResponse.json({
      rerankedJobs: object.reranked_job_ids,
      filteredOutJobs: object.filtered_out_job_ids,
    });
  } catch {
    return NextResponse.json({
      message: "An error occurred",
    });
  }
}
