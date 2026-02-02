import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import { IResumeReview } from "@/lib/types";
import ResumeReviewsTable from "@/components/ResumeReviewsTable";
import CreateResumeReviewDialog from "@/components/CreateResumeReviewDialog";

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
      .select("id, created_at, resumes(name), status, job_id, name")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (reviewsError) {
      throw reviewsError;
    }

    return (
      <div className="flex flex-col w-full gap-8 p-4 mb-20">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h1 className="text-3xl font-medium ">All CV Reviews</h1>
          <CreateResumeReviewDialog userId={user.id} />
        </div>
        <ResumeReviewsTable
          data={(reviews as unknown as IResumeReview[]) || []}
        />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
