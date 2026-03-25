import { allJobsSelectString } from "@/helpers/jobs/filterQueryBuilder";
import { createClient } from "@/lib/supabase/client";
import { QueryData } from "@supabase/supabase-js";

const supabase = createClient();

const applicationQuery = supabase
  .from("applications")
  .select(
    `
        id,
        applicant_user_id,
        created_at,
        status,
        resumes(resume_path),
        answers,
        job_post_id,
        user_info(
          *
        ),
        job_postings(
          id,
          title,
          company_id,
          questions,
          description,
          job_type,
          location,
          company_info(name)
        )
      `,
  )
  .eq("id", "")
  .single();

const jobIdSelectString = `
             ${allJobsSelectString},
              description,
              user_favorites(*),
              job_postings(*, company_info(*), applications(*)),
              applications(*),
              job_feedback(vote_type)
          `;

const jobIdQuery = supabase
  .from("all_jobs")
  .select(jobIdSelectString)
  .eq("id", "")
  .single();

const companyIdSelectString = supabase
  .from("job_postings")
  .select(
    `
          id,
          title,
          company_id,
          description,
          location,
          job_type,
          salary_currency,
          salary_range,
          equity_range,
          experience,
          min_salary,
          max_salary,
          min_experience,
          max_experience,
          visa_sponsorship,
          min_equity,
          max_equity,
          questions,
          status,
          job_id,
          updated_at,
          applications(id),
          company_info(name, website)
        `,
  )
  .single();

export type TJobIdPageData = QueryData<typeof jobIdQuery>;
export type TApplication1 = QueryData<typeof applicationQuery>;
export type TCompanyIdPageData = QueryData<typeof companyIdSelectString>;
