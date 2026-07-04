export type AiSearchProfileBody = {
  userId: string;
  jobId: string | null;
  companyId: string;
  profiles: {
    user_id: string;
    full_name: string | null;
    desired_roles: string[] | null;
    experience_years: number | null;
    preferred_locations: string[] | null;
    industry_preferences: string[] | null;
    top_skills: string[] | null;
    work_style_preferences: string[] | null;
    job_type: string[];
    company_size_preference: string | null;
    career_goals_short_term: string | null;
    career_goals_long_term: string | null;
    resume_experience: string;
    resume_projects: string;
    resume_skills: string;
  }[];
};
