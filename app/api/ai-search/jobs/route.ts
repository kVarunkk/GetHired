import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  AllJobWithRelations,
  TAICredits,
  TResumeRowContent,
} from "@/utils/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { rerankWithJev } from "@/utils/rerank-jev";
import { extractSectionText } from "@/utils/extract-resume-content";
import { google } from "@ai-sdk/google";

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
      type: "job_digest" | "job_digest_with_suggestions";
    } = await request.json();

    if (!userId || !jobs) {
      return NextResponse.json(
        {
          message: "user_id and jobs are required in the request body.",
        },
        { status: 400 },
      );
    }

    const [jobsResponse, userResponse] = await Promise.all([
      supabase
        .from("all_jobs")
        .select("id, description")
        .in(
          "id",
          jobs.map((each) => each.id),
        ),
      supabase
        .from("user_info")
        .select(
          "desired_roles, experience_years, preferred_locations, salary_currency, min_salary, max_salary, top_skills, company_size_preference, career_goals_short_term, career_goals_long_term, visa_sponsorship_required, work_style_preferences, ai_credits, job_type, resumes(content, is_primary)",
        )
        .eq("user_id", userId)
        .eq("resumes.is_primary", true)
        .single(),
    ]);

    if (userResponse.error) throw userResponse.error;
    if (jobsResponse.error) throw jobsResponse.error;

    const userPreferences = userResponse.data;

    if (!userPreferences) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    const descriptionMap = new Map(
      jobsResponse.data?.map((job) => [job.id, job.description]) || [],
    );

    const enrichedJobs = jobs.map((job) => ({
      ...job,
      description: descriptionMap.get(job.id) || "",
    }));

    const resumeContent = userPreferences.resumes?.[0]
      ?.content as TResumeRowContent;

    const { experience, skills, projects } = extractSectionText(
      ["experience", "skills", "projects"],
      resumeContent,
    );

    const candidate = {
      id: userId,
      preferences: {
        desired_roles: userPreferences.desired_roles ?? undefined,
        top_skills: userPreferences.top_skills ?? undefined,
        experience_years: userPreferences.experience_years ?? undefined,
        preferred_locations: userPreferences.preferred_locations ?? undefined,
        min_salary: userPreferences.min_salary ?? undefined,
        max_salary: userPreferences.max_salary ?? undefined,
        work_style_preferences:
          userPreferences.work_style_preferences ?? undefined,
        job_type: userPreferences.job_type ?? undefined,
        company_size_preference:
          userPreferences.company_size_preference ?? undefined,
        career_goals_short_term:
          userPreferences.career_goals_short_term ?? undefined,
        career_goals_long_term:
          userPreferences.career_goals_long_term ?? undefined,
        visa_sponsorship_required:
          userPreferences.visa_sponsorship_required ?? undefined,
      },
      experienceText: experience,
      skillsText: skills,
      projectsText: projects,
    };

    const object = await rerankWithJev({
      type,
      reference: candidate,
      items: enrichedJobs,
    });

    let finalRerankedJobs:
      | string[]
      | {
          id: string;
          reason: string;
        }[] = object.reranked_job_ids || [];

    // only for job digest
    if (
      type === "job_digest_with_suggestions" &&
      finalRerankedJobs.length > 0
    ) {
      // 1. Isolate the top 10 job matches from Jev's output
      const top10JobIds = finalRerankedJobs.slice(0, 10);
      const jobsToGenerateReasonsFor = enrichedJobs.filter((j) =>
        top10JobIds.includes(j.id),
      );

      // 2. Synthesize the candidate data package for Gemini
      const candidateSummary = `
        Desired Roles: ${candidate.preferences.desired_roles?.join(", ")}
        Experience Text: ${candidate.experienceText}
        Skills: ${candidate.preferences.top_skills?.join(", ")}
        Skills Text: ${candidate.skillsText}
        Projects Text: ${candidate.projectsText}
        Years of Experience: ${candidate.preferences.experience_years}
        Preferred Locations: ${candidate.preferences.preferred_locations?.join(", ")}
        Salary Range: ${userPreferences.salary_currency}${candidate.preferences.min_salary} - ${userPreferences.salary_currency}${candidate.preferences.max_salary}
      `.trim();

      // 3. Make a single batch generative call for only the top 10 jobs
      const modelInstance = google("gemini-3.1-flash-lite");

      // 3. Generate structured text output using your specific schema layout
      const { output: reasonResult } = await generateText({
        model: modelInstance,
        output: Output.object({
          schema: z.object({
            reranked_jobs: z.array(
              z.object({
                id: z.string(),
                reason: z
                  .string()
                  .describe(
                    "Two sentences, max 50 words, specific to this candidate and job. Must reference a concrete skill or experience overlap. Written in second person.",
                  ),
              }),
            ),
          }),
        }),
        prompt: `
          You are an expert search re-ranker. Your task is to evaluate the provided job listings
          against a user's query and write a short reason why they match.
          
          **User Query:**
          ${candidateSummary}

          **Job Listings to Evaluate:**
          ${jobsToGenerateReasonsFor
            .map(
              (job) => `
            ---
            ID: ${job.id}
            Title: ${job.job_name}
            Description: ${job.description?.slice(0, 1500)}
            Experience: ${job.experience}
            ---
          `,
            )
            .join("\n")}
          
          **Instructions:**
          For each job, write a reason: two sentences, max 50 words, second person ("Your...").
          Be specific — reference the actual skill or experience overlap, never generic phrases like "Great match".
          Example: "Your 3 years of React experience aligns directly with their frontend-heavy stack."
          Output only valid JSON matching the schema. No other text.
        `,
      });

      finalRerankedJobs = reasonResult.reranked_jobs;
    }

    await deductUserCreditsHelper(
      supabase,
      userId,
      TAICredits.AI_SEARCH_ASK_AI_RESUME,
    );

    return NextResponse.json({
      rerankedJobs:
        type === "job_digest_with_suggestions"
          ? finalRerankedJobs
          : (object as { reranked_job_ids?: string[] }).reranked_job_ids,
      filteredOutJobs: object.filtered_out_ids,
    });
  } catch {
    return NextResponse.json({
      message: "An error occurred",
    });
  }
}

// console.log(experience, skills, projects);

// console.log(
//   enrichedJobs.slice(0, 5).map((each) => each.description?.slice(0, 400)),
// );

// const userQuery = `
//   User is a candidate with the following preferences:
//   - Desired Roles: ${userPreferences.desired_roles?.join(", ")}
//   - Work Experience: ${experience}
//   - Skills: ${skills + userPreferences.top_skills?.join(", ")}
//   - Projects: ${projects}
//   - Years of Experience: ${userPreferences.experience_years}
//   - Preferred Locations: ${userPreferences.preferred_locations?.join(", ")}
//   - Salary Range: $${userPreferences.min_salary} - $${
//     userPreferences.max_salary
//   }
//   - Work Style: ${userPreferences.work_style_preferences?.join(", ")}
//   - Job Type: ${userPreferences.job_type?.join(", ")}
//   - Company Size: ${userPreferences.company_size_preference}
//   - Career Goals: ${userPreferences.career_goals_short_term} and ${
//     userPreferences.career_goals_long_term
//   }
//   - Visa Sponsorship: ${
//     userPreferences.visa_sponsorship_required ? "Yes" : "No"
//   }

//   Please re-rank the job listings to find the best possible match for this candidate.
// `;

// const vertex = await getVertexClient();
// const model = vertex("gemini-2.5-flash-lite");
// const model = google("gemini-3.1-flash-lite");

// const rerankPrompt = `
//   You are an expert search re-ranker. Your task is to evaluate a set of job listings
//   against a user's query and re-rank them based on relevance, skills required,
//   and experience level. You must only use the information provided for the jobs.

//   **User Query:**
//   ${userQuery}

//   **Job Listings to Evaluate:**
//   ${jobs
//     .map(
//       (job) => `
//     ---
//     ID: ${job.id}
//     Title: ${job.job_name}
//     Description: ${job.description?.slice(0, 2500)}
//     Experience: ${job.experience}
//     Visa Requirement: ${job.visa_requirement}
//     Salary Range: ${job.salary_range}
//     Locations: ${job.locations}
//     ---
//   `,
//     )
//     .join("\n")}

//   **Instructions:**
//   1.  Read the user's query carefully.
//   2.  Analyze each job listing to determine its relevance to the query.
//   3.  Re-rank the jobs from most relevant to least relevant.
//   4.  Filter out any jobs that are completely irrelevant or do not match the user's core intent.
//   5.  Output only valid JSON matching the schema. No other text.
//   ${
//     type === "job_digest_with_suggestions" &&
//     `6. For each job you keep, write a reason: two sentences, max 50 words, second person ("Your...").
//  Be specific — reference the actual skill or experience overlap, never generic phrases like "Great match".
//  Example: "Your 3 years of React experience aligns directly with their frontend-heavy stack."`
//   }
// `;

// const { output: object } = await generateText({
//   model: model,
//   prompt: rerankPrompt,
//   output: Output.object({
//     schema: z.object({
//       ...(type === "job_digest_with_suggestions"
//         ? {
//             reranked_jobs: z
//               .array(
//                 z.object({
//                   id: z.string(),
//                   reason: z
//                     .string()
//                     .describe(
//                       "Two sentences, max 50 words, specific to this candidate and job. Must reference a concrete skill or experience overlap. Written in second person.",
//                     ),
//                 }),
//               )
//               .describe("Re-ranked jobs from most to least relevant"),
//           }
//         : {
//             reranked_job_ids: z
//               .array(z.string())
//               .describe(
//                 "The list of re-ranked job IDs from most to least relevant.",
//               ),
//           }),

//       filtered_out_job_ids: z
//         .array(z.string())
//         .describe(
//           "The list of job IDs that were filtered out as irrelevant.",
//         ),
//     }),
//   }),
// });
