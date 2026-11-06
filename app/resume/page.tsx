import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import ResumesTable from "@/components/ResumesTable";
import CreateResumeDialog from "@/components/CreateResumeDialog";
import ResumeReuploadPrompt from "@/components/resume/ResumeReuploadPrompt";
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
      .select(
        "id, created_at, name, is_primary, parsing_failed, schema_version, content, resume_reviews(count)",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (resumesError) {
      throw resumesError;
    }

    // RE-REQ-098/103: a resume with no content and no working file can't be
    // edited, copied or exported, so it's asked for again here. Its reviews and
    // applications still point at the same row.
    const rows = (resumes ?? []).map(({ resume_reviews, content, ...resume }) => ({
      ...resume,
      has_content: content !== null && content !== undefined,
      review_count: resume_reviews[0]?.count ?? 0,
    }));

    const tableKey = `${rows.length}-${rows[0]?.id || "empty"}`;

    return (
      <div className="flex flex-col w-full gap-6 p-4 mb-20">
        <PageHeader
          title="Resumes"
          description="Resumes you've built, tailored to the jobs you want."
          actions={<CreateResumeDialog />}
        />
        {user.app_metadata.type === "applicant" && <AskAgentAboutResumes />}
        <ResumeReuploadPrompt
          resume={rows.find((row) => row.parsing_failed && !row.has_content) ?? null}
        />
        <ResumesTable key={tableKey} data={rows} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
