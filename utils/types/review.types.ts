import { createClient } from "@/lib/supabase/client";
import { QueryData } from "@supabase/supabase-js";

const supabase = createClient();

const resumeReviewServerQuery = supabase
  .from("resume_reviews")
  .select(
    `
      *,
      resumes (
        id,
        name,
        content,
        resume_path,
        parsing_failed
      )
    `,
  )
  .eq("id", "")
  .single();

const resumeReviewTableQuery = supabase
  .from("resume_reviews")
  .select("id, created_at, resumes(name), status, job_id, name")
  .single();
//   .eq("user_id", "")

const resumeReviewResumesQuery = supabase
  .from("resumes")
  .select("id, name, created_at, is_primary")
  .eq("user_id", "")
  .single();

export type TResumeReviewServer = QueryData<typeof resumeReviewServerQuery> & {
  ai_response?: {
    overall_feedback?: string;
    score?: string;
    bullet_points?: {
      bullet_id: string;
      section: string;
      original: string;
      suggested: string;
      reason: string;
      priority: string;
    }[];
  } | null;
};
export type TResumeReviewResume = QueryData<typeof resumeReviewResumesQuery>;
export type TResumeReviewTable = QueryData<typeof resumeReviewTableQuery>;
