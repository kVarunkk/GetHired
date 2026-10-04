import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { extractSectionText } from "@/utils/extract-resume-content";
import { TResumeRowContent } from "@/utils/types";
import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";

export async function loadInterviewData(userId: string, interviewId: string) {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("interviews")
    .select("resume_id, job_id")
    .eq("id", interviewId)
    .single();

  if (error || !data) throw new Error("Interview not found.");

  if (!data.resume_id) {
    throw new Error("Resume ID not found for the interview.");
  }

  const [jobsResponse, userResponse] = await Promise.all([
    supabase
      .from("all_jobs")
      .select("id, job_name, description")
      .eq("id", data.job_id ?? "")
      .single(),
    supabase
      .from("user_info")
      .select(
        "full_name, desired_roles, experience_years, preferred_locations, salary_currency, min_salary, max_salary, top_skills, company_size_preference, career_goals_short_term, career_goals_long_term, visa_sponsorship_required, work_style_preferences, ai_credits, job_type, resumes(id, content, is_primary)",
      )
      .eq("user_id", userId)
      .eq("resumes.id", data.resume_id)
      .single(),
  ]);

  if (userResponse.error) throw userResponse.error;
  if (jobsResponse.error) throw jobsResponse.error;

  const userPreferences = userResponse.data;

  if (!userPreferences.resumes?.[0]?.content) {
    throw new Error("Resume content not found.");
  }

  const jobData = jobsResponse.data;

  const resumeContent = userPreferences.resumes?.[0]
    ?.content as TResumeRowContent;

  const { experience, skills, projects } = extractSectionText(
    ["experience", "skills", "projects"],
    resumeContent,
  );

  const rawCandidate = {
    id: userId,
    preferences: userPreferences,
    experienceText: experience,
    skillsText: skills,
    projectsText: projects,
  };

  const model = google("gemini-3.1-flash-lite");

  const { output } = await generateText({
    model: model,
    system:
      "You are a helpful assistant that strips fluff and normalizes text into concise, high-density summaries for downstream AI prompt context.",
    prompt: `
      Summarize the candidate profile and job posting below into clean, bulleted, dense context strings.
      
      CANDIDATE DATA:
      ${JSON.stringify(rawCandidate)}

      JOB DATA:
      ${JSON.stringify(jobData)}
    `,
    output: Output.object({
      schema: z.object({
        profile: z
          .string()
          .describe(
            "A concise summary of the candidate's core background, key skills, experience level, and preferences. Omit boilerplate or fluff.",
          ),
        job: z
          .string()
          .describe(
            "A concise summary of the job requirements, responsibilities, and key skills. Stripped of boilerplate hiring buzzwords.",
          ),
      }),
    }),
  });

  return {
    profile: {
      name: userResponse.data.full_name,
      text: output.profile,
    },
    job: {
      title: jobsResponse.data.job_name,
      description: output.job,
    },
  };
}
