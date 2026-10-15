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
        job_postings(
          id,
          title
        ),
        user_info(
          full_name
        ),
        application_screenings(
          status,
          fit_score,
          recommendation
        )
      `,
  )
  .single();

export type TApplicationServer = QueryData<typeof applicantsServerQuery>;
