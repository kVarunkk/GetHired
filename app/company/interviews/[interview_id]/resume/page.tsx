import { unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import { FileUser } from "lucide-react";
import Error from "@/components/Error";
import ResumePreview from "@/components/resume/ResumePreview";
import SectionHeader from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { loadKitResume } from "@/helpers/interviews/kit-resume";
import { requireOpenKit } from "@/helpers/interviews/kit-page";

export const metadata: Metadata = {
  title: "Resume",
};

/** The resume the candidate applied with: the document, or a link to the file. */
export default async function InterviewKitResumePage({ params }: { params: Promise<{ interview_id: string }> }) {
  try {
    const { interview_id } = await params;
    const { supabase, kit } = await requireOpenKit(interview_id);
    const resume = await loadKitResume(supabase, kit.interview.id);
    return (
      <>
        <SectionHeader title="Resume" />
        {resume?.kind === "document" ? (
          <div className="overflow-hidden rounded-xl border">
            <ResumePreview document={resume.document} />
          </div>
        ) : resume?.kind === "file" ? (
          <Button asChild variant="outline" className="self-start">
            <a href={`/api/interviews/${kit.interview.id}/resume`} target="_blank" rel="noopener noreferrer">
              <FileUser className="h-4 w-4" /> Open resume
            </a>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">No resume.</p>
        )}
      </>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
