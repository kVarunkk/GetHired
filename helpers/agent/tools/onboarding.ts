import { tool } from "ai";
import { z } from "zod";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { completeApplicantOnboarding } from "@/helpers/user/complete-onboarding";
import { COMPANY_SIZES, JOB_TYPES } from "@/helpers/user/onboarding-profile";
import { AgentToolContext, uuidInput, withToolErrors } from "./shared";
import { SALARY_CURRENCIES } from "./profile";

const list = (max: number) =>
  z.array(z.string().trim().min(1).max(60)).min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();

/** The onboarding form's fields (REQ-020), in camelCase for the model. */
const onboardingInput = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    desiredRoles: list(10),
    jobTypes: z.array(z.enum(JOB_TYPES)).min(1),
    salaryCurrency: z.enum(SALARY_CURRENCIES),
    minSalary: z
      .number()
      .int()
      .min(0)
      .describe("Minimum yearly salary as a plain integer."),
    maxSalary: z.number().int().min(0).optional(),
    preferredLocations: list(10),
    experienceYears: z.number().min(0).max(60),
    topSkills: list(30),
    workStylePreferences: list(10).describe(
      "e.g. Remote, Hybrid, On-site, Startup Environment.",
    ),
    companySizePreference: z.enum(COMPANY_SIZES),
    linkedinUrl: z.string().trim().url().optional(),
    githubUrl: z.string().trim().url().optional(),
    industryPreferences: list(10).optional(),
    careerGoalsShortTerm: optionalText(500),
    careerGoalsLongTerm: optionalText(500),
    visaSponsorshipRequired: z.boolean().optional(),
    resumeId: uuidInput("resume")
      .optional()
      .describe(
        "From requestResumeUpload or listResumes; omit to use the primary resume.",
      ),
  })
  .strict()
  .refine(
    (input) =>
      input.maxSalary === undefined || input.maxSalary >= input.minSalary,
    {
      message: "maxSalary must not be less than minSalary.",
      path: ["maxSalary"],
    },
  );

type OnboardingInput = z.infer<typeof onboardingInput>;

/** Input field → `user_info` column, for the fields that are set. */
function toProfileColumns(
  input: Omit<OnboardingInput, "resumeId">,
  locations: string[],
) {
  const columns = {
    full_name: input.fullName,
    desired_roles: input.desiredRoles,
    job_type: input.jobTypes,
    salary_currency: input.salaryCurrency,
    min_salary: input.minSalary,
    max_salary: input.maxSalary,
    preferred_locations: locations,
    experience_years: input.experienceYears,
    top_skills: input.topSkills,
    work_style_preferences: input.workStylePreferences,
    company_size_preference: input.companySizePreference,
    linkedin_url: input.linkedinUrl,
    github_url: input.githubUrl,
    industry_preferences: input.industryPreferences,
    career_goals_short_term: input.careerGoalsShortTerm,
    career_goals_long_term: input.careerGoalsLongTerm,
    visa_sponsorship_required: input.visaSponsorshipRequired,
  };
  return Object.fromEntries(
    Object.entries(columns).filter(([, value]) => value !== undefined),
  );
}

export function createOnboardingTools(ctx: AgentToolContext) {
  const { supabase } = ctx;

  return {
    completeOnboarding: tool({
      description:
        "Finish the user's onboarding with their profile and resume, the same as the /get-started form. Only for users whose profile shows onboarding isn't complete; gather the required fields first. The user must approve.",
      inputSchema: onboardingInput,
      execute: ({ resumeId, ...input }) =>
        withToolErrors(ctx, "completeOnboarding", async () => {
          const { data: profile, error: profileError } = await supabase
            .from("user_info")
            .select("filled")
            .eq("user_id", ctx.user.id)
            .maybeSingle();
          if (profileError) throw profileError;
          if (profile?.filled) {
            return {
              error: "ALREADY_ONBOARDED",
              message:
                "The user is already onboarded. Use updateMyPreferences to change their profile.",
            };
          }

          const resumes = supabase
            .from("resumes")
            .select("id, name, content, parsing_failed")
            .eq("user_id", ctx.user.id);
          const { data: resume, error: resumeError } = await (
            resumeId
              ? resumes.eq("id", resumeId)
              : resumes.eq("is_primary", true)
          ).maybeSingle();
          if (resumeError) throw resumeError;
          if (!resume) {
            return {
              error: "NO_RESUME",
              message:
                "Onboarding needs a resume. Ask the user to upload one with requestResumeUpload, then pass its resumeId.",
            };
          }
          if (resume.parsing_failed) {
            return {
              error:
                "This resume couldn't be read. Ask the user to upload it again.",
            };
          }
          if (!resume.content) {
            return {
              error:
                "This resume is still being processed. Try again in a minute.",
            };
          }

          // Canonical names, as the location picker would save (REQ-023).
          const preferredLocations = await canonicalizeLocations(
            input.preferredLocations,
          );

          const result = await completeApplicantOnboarding(
            supabase,
            ctx.user,
            toProfileColumns(input, preferredLocations),
            // The agent's upload already parsed (and charged for) the resume.
            { resumeId: resume.id, shouldParse: false },
          );
          if (!result.ok) return { error: result.error };

          return {
            onboarded: true,
            resume: { id: resume.id, name: resume.name },
            preferredLocations,
          };
        }),
    }),
  };
}
