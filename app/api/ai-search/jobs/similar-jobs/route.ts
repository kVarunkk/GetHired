import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { IJob, TAICredits } from "@/lib/types";
import { getVertexClient } from "@/lib/serverUtils";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { userId, jobId, jobs, aiCredits } = await request.json();

    if (!jobId || !userId || !jobs || !aiCredits) {
      return NextResponse.json(
        {
          message: "jobId, userId and jobs are required in the request body.",
        },
        { status: 400 }
      );
    }

    // Step 1: Fetch user preferences from the database
    const { data: targetJobData, error: jobError } = await supabase
      .from("all_jobs")
      .select(
        "job_name, description, experience, visa_requirement, salary_range, locations"
      )
      .eq("id", jobId)
      .single();

    if (jobError || !targetJobData) {
      return NextResponse.json(
        { message: "Target job for comparison not found." },
        { status: 404 }
      );
    }

    // Step 2: Construct the userQuery based on fetched preferences
    const targetJobDescription = `
            Target Job (The reference job to find similarities to):
            - Title: ${targetJobData.job_name}
            - Description: ${targetJobData.description}
            - Experience Required: ${targetJobData.experience}
            - Visa Sponsorship: ${targetJobData.visa_requirement ? "Required" : "Not Required"}
            - Salary Range: ${targetJobData.salary_range}
            - Locations: ${targetJobData.locations?.join(", ")}
        `;

    const rerankPrompt = `
           You are an expert search re-ranker specializing in technical recruitment. Your task is to evaluate a set of candidate job listings and rank them based on their **relevance** to a Target Job.
            
            **Target Job Query (Find jobs similar to this):**
            ${targetJobDescription}

            **Candidate Job Listings to Evaluate:**
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
    1. **Rank by Relevance:** Order the jobs from the most relevant to the least relevant. Focus on transferable skills, domain expertise, and core technology overlap.
    2. **Be Inclusive:** Do not discard jobs just because they have a different title or a slightly different seniority level, provided the technical skills overlap significantly (e.g., a "Frontend Engineer" is highly relevant to a "Javascript Developer" role).
    3. **Filter Only Extremes:** Only exclude jobs that are completely unrelated in domain or function (e.g., exclude a 'Sales Executive' if the target is 'Software Engineer'). 
    4. **Output Format:** Return a JSON object with a key "ranked_ids" containing an array of IDs in order of relevance.
        `;

    // Step 3: Call the AI with the augmented prompt
    const vertex = await getVertexClient();
    const model = vertex("gemini-2.0-flash-lite-001");

    const { object } = await generateObject({
      model: model,
      prompt: rerankPrompt,
      schema: z.object({
        reranked_job_ids: z
          .array(z.string())
          .describe(
            "The list of re-ranked job IDs from most to least similar to the target job."
          ),

        filtered_out_job_ids: z
          .array(z.string())
          .describe(
            "The list of job IDs that were filtered out as dissimilar."
          ),
      }),
    });

    await supabase
      .from("user_info")
      .update({
        ai_credits: aiCredits - TAICredits.AI_SEARCH_OR_ASK_AI,
      })
      .eq("user_id", userId);

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
