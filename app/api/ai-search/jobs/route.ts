import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AllJobWithRelations, TAICredits, TResumeContent } from "@/utils/types";
import { getVertexClient } from "@/utils/vertex";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";

export async function POST(request: NextRequest) {
  try {
    const internalSecret = request.headers.get("X-Internal-Secret");
    const isInternalCall = internalSecret === process.env.INTERNAL_API_SECRET;

    const supabase = isInternalCall
      ? createServiceRoleClient()
      : await createClient();

    const {
      userId,
      jobs,
      type,
    }: {
      userId: string;
      jobs: AllJobWithRelations[];
      type?: "job_digest" | "job_digest_with_suggestions";
    } = await request.json();

    if (!userId || !jobs) {
      return NextResponse.json(
        {
          message: "user_id and jobs are required in the request body.",
        },
        { status: 400 },
      );
    }

    const { data } = await supabase
      .from("user_info")
      .select(
        "desired_roles, experience_years, preferred_locations, min_salary, max_salary, top_skills, company_size_preference, career_goals_short_term, career_goals_long_term, visa_sponsorship_required, work_style_preferences, ai_credits, job_type, resumes(content, is_primary)",
      )
      .eq("user_id", userId)
      .eq("resumes.is_primary", true)
      .single();
    const userPreferences = data;

    if (!userPreferences) {
      return NextResponse.json(
        {
          message: "User not found.",
        },
        { status: 404 },
      );
    }

    const { experience, skills, projects } = (userPreferences.resumes?.[0]
      ?.content as TResumeContent) || {
      experience: "",
      skills: "",
      projects: "",
    };

    const userQuery = `
      User is a candidate with the following preferences:
      - Desired Roles: ${userPreferences.desired_roles?.join(", ")}
      - Work Experience: ${experience}
      - Skills: ${skills + userPreferences.top_skills?.join(", ")}
      - Projects: ${projects}
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
          (job) => `
        ---
        ID: ${job.id}
        Title: ${job.job_name}
        Description: ${job.description?.slice(0, 2500)}
        Experience: ${job.experience}
        Visa Requirement: ${job.visa_requirement}
        Salary Range: ${job.salary_range}
        Locations: ${job.locations}
        ---
      `,
        )
        .join("\n")}
      
      **Instructions:**
      1.  Read the user's query carefully.
      2.  Analyze each job listing to determine its relevance to the query.
      3.  Re-rank the jobs from most relevant to least relevant.
      4.  Filter out any jobs that are completely irrelevant or do not match the user's core intent.
      5.  Output only valid JSON matching the schema. No other text.
      ${
        type === "job_digest_with_suggestions" &&
        `6. For each job you keep, write a reason: two sentences, max 50 words, second person ("Your...").
     Be specific — reference the actual skill or experience overlap, never generic phrases like "Great match".
     Example: "Your 3 years of React experience aligns directly with their frontend-heavy stack."`
      }
    `;

    const { output: object } = await generateText({
      model: model,
      prompt: rerankPrompt,
      output: Output.object({
        schema: z.object({
          ...(type === "job_digest_with_suggestions"
            ? {
                reranked_jobs: z
                  .array(
                    z.object({
                      id: z.string(),
                      reason: z
                        .string()
                        .describe(
                          "Two sentences, max 50 words, specific to this candidate and job. Must reference a concrete skill or experience overlap. Written in second person.",
                        ),
                    }),
                  )
                  .describe("Re-ranked jobs from most to least relevant"),
              }
            : {
                reranked_job_ids: z
                  .array(z.string())
                  .describe(
                    "The list of re-ranked job IDs from most to least relevant.",
                  ),
              }),

          filtered_out_job_ids: z
            .array(z.string())
            .describe(
              "The list of job IDs that were filtered out as irrelevant.",
            ),
        }),
      }),
    });

    await deductUserCreditsHelper(
      supabase,
      userId,
      TAICredits.AI_SEARCH_ASK_AI_RESUME,
    );

    return NextResponse.json({
      rerankedJobs:
        type === "job_digest_with_suggestions"
          ? (
              object as {
                reranked_jobs?: {
                  id: string;
                  reason: string;
                }[];
              }
            ).reranked_jobs
          : (object as { reranked_job_ids?: string[] }).reranked_job_ids,
      filteredOutJobs: object.filtered_out_job_ids,
    });
  } catch {
    return NextResponse.json({
      message: "An error occurred",
    });
  }
}
