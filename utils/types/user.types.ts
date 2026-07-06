import { createClient } from "@/lib/supabase/client";
import { QueryData } from "@supabase/supabase-js";

const supabase = createClient();

const applicantProfileQuery = supabase
  .from("user_info")
  .select(
    `
    full_name,
    user_id,
    linkedin_url,
    github_url,
    email,
    min_salary,
    max_salary,
    experience_years,
    work_style_preferences,
    company_size_preference,
    career_goals_long_term,
    career_goals_short_term,
    visa_sponsorship_required,
    preferred_locations,
    desired_roles,
    salary_currency,
    top_skills,
    resumes(resume_path),
    applications(
      id,
      status,
      created_at,
      job_postings!inner(
        id,
        title,
        company_id
      )
    )
  `,
  )
  .eq("user_id", "")
  .single();

export type TApplicantProfile = QueryData<typeof applicantProfileQuery>;
