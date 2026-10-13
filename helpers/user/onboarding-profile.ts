import { z } from "zod";
import { isValidUrl } from "@/utils/utils";

export const JOB_TYPES = ["Fulltime", "Contract", "Intern"] as const;
export const COMPANY_SIZES = ["Small (1-50)", "Medium (51-500)", "Large (500+)", "Any"] as const;

const requiredList = z.array(z.string().trim().min(1)).min(1);
/**
 * Sent but empty (the form's untouched fields) becomes null. Not sent stays
 * undefined, so the upsert leaves the existing value alone.
 */
const optionalText = z
  .string()
  .nullish()
  .transform((value) =>
    value === undefined ? undefined : value?.trim() ? value.trim() : null,
  );
const optionalUrl = optionalText.refine((value) => value == null || isValidUrl(value), {
  message: "must be a valid URL",
});

/**
 * The applicant profile onboarding saves, in `user_info` column names, with
 * the onboarding form's rules (REQ-020). Parsing strips every other key, so
 * this schema is also the column allowlist (SEC-009).
 */
export const onboardingProfileSchema = z
  .object({
    full_name: z.string().trim().min(1),
    desired_roles: requiredList,
    job_type: z.array(z.enum(JOB_TYPES)).min(1),
    salary_currency: z.string().trim().min(1),
    min_salary: z.number().min(0),
    max_salary: z.number().min(0).nullish(),
    preferred_locations: requiredList,
    experience_years: z.number().min(0),
    top_skills: requiredList,
    work_style_preferences: requiredList,
    company_size_preference: z.string().trim().min(1),
    linkedin_url: optionalUrl,
    github_url: optionalUrl,
    industry_preferences: z.array(z.string().trim().min(1)).optional(),
    career_goals_short_term: optionalText,
    career_goals_long_term: optionalText,
    visa_sponsorship_required: z.boolean().optional(),
  })
  .refine((p) => p.max_salary == null || p.max_salary >= p.min_salary, {
    message: "must not be less than min_salary",
    path: ["max_salary"],
  });

export type OnboardingProfile = z.infer<typeof onboardingProfileSchema>;

/** The first validation problem, as "Invalid <field>: <message>". */
export function describeProfileError(error: z.ZodError) {
  const issue = error.issues[0];
  return `Invalid ${issue.path.join(".") || "profile"}: ${issue.message}`;
}
