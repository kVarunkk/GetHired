import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import ResumeEditor from "@/components/resume/ResumeEditor";
import ResumeUpgradeGate from "@/components/resume/ResumeUpgradeGate";
import { isUuid } from "@/helpers/agent/auth";
import { readResume } from "@/helpers/resume/read-resume";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Edit resume",
  robots: { index: false, follow: false },
};

const unusedLinesOf = (notes: unknown): string[] => {
  const lines = (notes as { unusedLines?: unknown } | null)?.unusedLines;
  return Array.isArray(lines) ? lines.filter((line): line is string => typeof line === "string") : [];
};

export default async function EditResumePage({ params }: { params: Promise<{ resumeId: string }> }) {
  const { resumeId } = await params;
  if (!isUuid(resumeId)) notFound();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();

    const { data, error } = await supabase
      .from("resumes")
      .select("id, name, content, contact, template, revision, schema_version, parse_notes")
      .eq("id", resumeId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) notFound();

    const resume = readResume(data);

    return (
      <div className="flex w-full flex-col gap-6 p-4">
        <PageHeader
          backHref={`/resume/${resumeId}`}
          backLabel="Back to resume"
          title={resume.name ?? "Untitled resume"}
          description="Edit your resume. Changes show in the preview as you type."
        />
        {resume.schemaVersion === 1 ? (
          <ResumeUpgradeGate resumeId={resumeId} />
        ) : (
          <ResumeEditor
            resumeId={resumeId}
            revision={resume.revision}
            unusedLines={unusedLinesOf(resume.parse_notes)}
            initial={{
              name: resume.name ?? "Untitled resume",
              template: resume.template,
              content: resume.content,
              contact: resume.contact ?? { fullName: "", links: [] },
            }}
          />
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
