import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import InterviewsTable from "@/components/InterviewsTable";
import CreateInterviewDialog from "@/components/CreateInterviewDialog";
import PageHeader from "@/components/PageHeader";
import { AskAgentAboutInterviews } from "@/components/agent/AskAgentOnApplicantPages";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Interviews",
  description:
    "Mock interviews for the jobs you're preparing for, with feedback on each session.",
  robots: { index: false, follow: false },
};

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
      // Company screening interviews live on the dashboard, not here (SIT-054).
      .eq("kind", "practice")
      .order("created_at", { ascending: false });

    if (interviewsError) {
      throw interviewsError;
    }

    const tableKey = `${interviews?.length || 0}-${interviews?.[0]?.id || "empty"}`;

    return (
      <div className="flex flex-col w-full gap-6 p-4 mb-20">
        <PageHeader
          title="Interviews"
          description="Mock interviews for the jobs you're preparing for, with feedback on each session."
          actions={
            <CreateInterviewDialog
              initialOpen={create === "true"}
              initialJobUrl={jobUrl ?? ""}
            />
          }
        />
        <AskAgentAboutInterviews />
        <InterviewsTable key={tableKey} data={interviews || []} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
