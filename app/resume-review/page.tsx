import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import ResumeReviewsTable from "@/components/ResumeReviewsTable";
import CreateResumeReviewDialog from "@/components/CreateResumeReviewDialog";
import PageHeader from "@/components/PageHeader";
import { AskAgentAboutResumeReviews } from "@/components/agent/AskAgentOnApplicantPages";

export default async function ResumeReviewPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const { data: reviews, error: reviewsError } = await supabase
      .from("resume_reviews")
      .select(
        "id, created_at, resumes(name), all_jobs(job_name), status, job_id, name",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (reviewsError) {
      throw reviewsError;
    }

    const tableKey = `${reviews?.length || 0}-${reviews?.[0]?.id || "empty"}`;

    return (
      <div className="flex flex-col w-full gap-6 p-4 mb-20">
        <PageHeader
          title="Resume reviews"
          description="AI reviews of your resume against a job, with a score and what to fix."
          actions={<CreateResumeReviewDialog />}
        />
        <AskAgentAboutResumeReviews />
        <ResumeReviewsTable key={tableKey} data={reviews || []} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
