export type AiSearchProfileBody = {
  userId: string;
  job_post_id: string | null;
  companyId: string;
  profiles: {
    user_id: string;
    full_name: string | null;
    desired_roles: string[] | null;
    experience_years: number | null;
    preferred_locations: string[] | null;
    top_skills: string[] | null;
    work_style_preferences: string[] | null;
  }[];
};
