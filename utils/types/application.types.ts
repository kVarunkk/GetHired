import { createClient } from "@/lib/supabase/client";
import { QueryData } from "@supabase/supabase-js";

const supabase = createClient();

const applicantsServerQuery = supabase
  .from("applications")
  .select(
    `
        id,
        created_at,
        status,
        resume_url,
        answers_v2,
        applicant_user_id,
        company_candidate_id,
        job_postings(
          id,
          title
        ),
        user_info(
          full_name
        ),
        company_candidates(
          id,
          full_name,
          email,
          resume_path
        ),
        application_screenings(
          status,
          fit_score,
          recommendation
        ),
        application_knockouts(
          failed,
          reasons,
          action_taken
        )
      `,
  )
  .single();

export type TApplicationServer = QueryData<typeof applicantsServerQuery>;
