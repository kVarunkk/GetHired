import { createClient } from "@/lib/supabase/client";
import { QueryData } from "@supabase/supabase-js";

const supabase = createClient();

const applicantProfileQuery = supabase
  .from("user_info")
  .select(
    `
    *,
    resumes(resume_path),
    company_favorites(company_id),
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
