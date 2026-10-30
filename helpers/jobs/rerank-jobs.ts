import { generateText, Output } from "ai";
import { z } from "zod";
import { google } from "@ai-sdk/google";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import {
  AllJobWithRelations,
  TAICredits,
  TResumeRowContent,
} from "@/utils/types";
import { deductUserCreditsHelper } from "@/helpers/ai/deduct-user-credits";
import { rerankWithJev } from "@/utils/rerank-jev";
import { extractSectionText } from "@/utils/extract-resume-content";

export type JobRerankType = "job_digest" | "job_digest_with_suggestions";

export type JobRerankResult = {
  /** Ids in the new order; `{ id, reason }` on a digest with suggestions. */
  rerankedJobs: string[] | { id: string; reason: string }[] | undefined;
  filteredOutJobs: string[];
};

/** The jobs' full descriptions replace whatever the caller sent. */
async function withDescriptions(
  supabase: SupabaseClient<Database>,
  jobs: AllJobWithRelations[],
) {
  const { data, error } = await supabase
    .from("all_jobs")
    .select("id, description")
    .in(
      "id",
      jobs.map((each) => each.id),
    );
  if (error) throw error;

  const descriptionMap = new Map(
    data?.map((job) => [job.id, job.description]) || [],
  );
  return jobs.map((job) => ({
    ...job,
    description: descriptionMap.get(job.id) || "",
  }));
}

/**
 * Re-ranks `jobs` against `userId`'s profile and primary resume with Jev and
 * charges the user once. Shared by POST /api/ai-search/jobs and the job search
 * (`rerankJobsIfApplicable`), which runs it in-process with its own client.
 * Returns null when the profile is missing; throws on other errors.
 */
export async function rerankJobsForUser(
  supabase: SupabaseClient<Database>,
  {
    userId,
    jobs,
    type,
  }: { userId: string; jobs: AllJobWithRelations[]; type: JobRerankType },
): Promise<JobRerankResult | null> {
  const [enrichedJobs, userResponse] = await Promise.all([
    withDescriptions(supabase, jobs),
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

  const userPreferences = userResponse.data;
  if (!userPreferences) return null;

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
  if (type === "job_digest_with_suggestions" && finalRerankedJobs.length > 0) {
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

  return {
    rerankedJobs:
      type === "job_digest_with_suggestions"
        ? finalRerankedJobs
        : object.reranked_job_ids,
    filteredOutJobs: object.filtered_out_ids,
  };
}

/**
 * Re-ranks `jobs` by how similar they are to `jobId` with Jev and charges
 * `userId` once. Shared by POST /api/ai-search/jobs/similar-jobs and the job
 * search. Returns null when the reference job is missing; throws on other
 * errors.
 */
export async function rerankSimilarJobs(
  supabase: SupabaseClient<Database>,
  {
    userId,
    jobId,
    jobs,
  }: { userId: string; jobId: string; jobs: AllJobWithRelations[] },
): Promise<JobRerankResult | null> {
  const [enrichedJobs, referenceJobResponse] = await Promise.all([
    withDescriptions(supabase, jobs),
    supabase
      .from("all_jobs")
      .select("id, job_name, description, experience, salary_range, locations")
      .eq("id", jobId)
      .single(),
  ]);

  if (referenceJobResponse.error) throw referenceJobResponse.error;
  if (!referenceJobResponse.data) return null;

  const object = await rerankWithJev({
    type: "similar_jobs",
    reference: referenceJobResponse.data as AllJobWithRelations,
    items: enrichedJobs,
  });

  await deductUserCreditsHelper(
    supabase,
    userId,
    TAICredits.AI_SEARCH_ASK_AI_RESUME,
  );

  return {
    rerankedJobs: object.reranked_job_ids,
    filteredOutJobs: object.filtered_out_ids,
  };
}
