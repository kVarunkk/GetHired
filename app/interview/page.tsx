import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import InterviewsTable from "@/components/InterviewsTable";
import CreateInterviewDialog from "@/components/CreateInterviewDialog";

export default async function InterviewPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string; jobUrl?: string }>;
}) {
  try {
    const { create, jobUrl } = await searchParams;
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const { data: interviews, error: interviewsError } = await supabase
      .from("interviews")
      .select("id, created_at, name, all_jobs(id, job_name), resumes(id, name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (interviewsError) {
      throw interviewsError;
    }

    const tableKey = `${interviews?.length || 0}-${interviews?.[0]?.id || "empty"}`;

    return (
      <div className="flex flex-col w-full gap-8 p-4 mb-20">
        <div className="flex items-center justify-between flex-wrap gap-4 w-full">
          <h1 className="text-3xl font-medium ">All Interviews</h1>
          <CreateInterviewDialog
            initialOpen={create === "true"}
            initialJobUrl={jobUrl ?? ""}
          />
        </div>
        <InterviewsTable key={tableKey} data={interviews || []} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
