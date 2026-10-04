import { createClient } from "@/lib/supabase/client";
import { QueryData } from "@supabase/supabase-js";

const supabase = createClient();

const interviewServerQuery = supabase
  .from("interviews")
  .select(
    `
        *,
        all_jobs(job_name),
        resumes(name)
      `,
  )
  .single();

const interviewsPageServerQuery = supabase
  .from("interviews")
  .select("id, created_at, name, all_jobs(id, job_name), resumes(id, name)")
  .single();

export type TInterviewServer = QueryData<typeof interviewServerQuery>;
export type TInterviewPageServer = QueryData<typeof interviewsPageServerQuery>;
