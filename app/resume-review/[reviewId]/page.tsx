import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import ResumeReviewClient from "@/components/ResumeReviewClient";
/**
 * SERVER COMPONENT: Resume Review Detail Page
 * Path: /resume-review/[reviewId]?job_id=xxx
 * * Handles initial data fetching for the review session, including
 * job descriptions and the user's resume library.
 */
export default async function ResumeReviewPage({
  params,
}: {
  params: Promise<{ reviewId: string }>;
}) {
  const { reviewId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <ErrorComponent />;

  const { data: review, error: reviewError } = await supabase
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
    .eq("id", reviewId)
    .single();

  if (reviewError || !review) return <ErrorComponent />;

  // 2. Hydrate Job Description
  let initialJd = review.target_jd || "";
  if (review.job_id && !initialJd) {
    const { data: jobData } = await supabase
      .from("all_jobs")
      .select("description")
      .eq("id", review.job_id)
      .single();

    if (jobData) initialJd = jobData.description;
  }

  // 3. Fetch user's library of resumes
  const { data: userResumes } = await supabase
    .from("resumes")
    .select("id, name, created_at, is_primary")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <ResumeReviewClient
      review={review}
      initialJd={initialJd}
      existingResumes={userResumes || []}
    />
  );
}
