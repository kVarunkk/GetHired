import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import InterviewsTable from "@/components/InterviewsTable";
import CreateInterviewDialog from "@/components/CreateInterviewDialog";
import PageHeader from "@/components/PageHeader";
import { AskAgentAboutInterviews } from "@/components/agent/AskAgentOnApplicantPages";
import MyScreeningInterviews from "@/components/interviews/MyScreeningInterviews";
import { listMyScreeningInterviews } from "@/helpers/interview/screening/my-interviews";
import InterviewTabs, { type InterviewsTab } from "@/components/interviews/InterviewTabs";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Interviews",
  description:
    "Mock interviews for the jobs you're preparing for, and AI interviews from companies you applied to.",
  robots: { index: false, follow: false },
};

export default async function InterviewPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string; jobUrl?: string; tab?: string }>;
}) {
  try {
    const { create, jobUrl, tab: tabParam } = await searchParams;
    const tab: InterviewsTab = tabParam === "companies" ? "companies" : "mock";
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    // Two tabs: practice interviews (?tab unset) and company screening
    // interviews from my_screening_interviews() (?tab=companies, SIT-054).
    // Both are read for the tab counts.
    const [{ data: interviews, error: interviewsError }, screeningInterviews] = await Promise.all([
      supabase
        .from("interviews")
        .select("id, created_at, name, all_jobs(id, job_name), resumes(id, name)")
        .eq("user_id", user.id)
        .eq("kind", "practice")
        .order("created_at", { ascending: false }),
      listMyScreeningInterviews(supabase),
    ]);

    if (interviewsError) {
      throw interviewsError;
    }

    const tableKey = `${interviews?.length || 0}-${interviews?.[0]?.id || "empty"}`;

    return (
      <div className="flex flex-col w-full gap-6 p-4 mb-20">
        <PageHeader
          title="Interviews"
          description="Mock interviews for the jobs you're preparing for, and AI interviews from companies you applied to."
          actions={
            <CreateInterviewDialog
              initialOpen={create === "true"}
              initialJobUrl={jobUrl ?? ""}
            />
          }
        />
        <AskAgentAboutInterviews />
        <InterviewTabs
          active={tab}
          counts={{ mock: interviews?.length ?? 0, companies: screeningInterviews.length }}
        />
        {tab === "companies" ? (
          <MyScreeningInterviews interviews={screeningInterviews} variant="all" />
        ) : (
          <InterviewsTable key={tableKey} data={interviews || []} />
        )}
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
