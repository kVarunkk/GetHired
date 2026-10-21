import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import ResumesTable from "@/components/ResumesTable";
import CreateResumeDialog from "@/components/CreateResumeDialog";
import PageHeader from "@/components/PageHeader";
import { AskAgentAboutResumes } from "@/components/agent/AskAgentOnApplicantPages";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resumes",
  description:
    "Resumes you've built, tailored to the jobs you want.",
  robots: { index: false, follow: false },
};

export default async function ResumePage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const { data: resumes, error: resumesError } = await supabase
      .from("resumes")
      .select("id, created_at, name, is_primary, parsing_failed")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (resumesError) {
      throw resumesError;
    }

    const tableKey = `${resumes?.length || 0}-${resumes?.[0]?.id || "empty"}`;

    return (
      <div className="flex flex-col w-full gap-6 p-4 mb-20">
        <PageHeader
          title="Resumes"
          description="Resumes you've built, tailored to the jobs you want."
          actions={<CreateResumeDialog />}
        />
        {user.app_metadata.type === "applicant" && <AskAgentAboutResumes />}
        <ResumesTable key={tableKey} data={resumes || []} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
