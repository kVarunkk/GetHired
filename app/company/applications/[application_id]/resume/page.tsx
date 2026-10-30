import { notFound, unstable_rethrow } from "next/navigation";
import { Download } from "lucide-react";
import Error from "@/components/Error";
import OriginalResumeWrapper from "@/components/OriginalResumeWrapper";
import SectionHeader from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { reportError } from "@/helpers/posthog/report-error";
import { loadApplicationFrame } from "@/helpers/applications/application-page";
import { RESUME_BUCKET, resumeExtensionOf } from "@/helpers/candidates/resume-files";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resume",
};

/** How long the viewer's link to the file works. */
const SIGNED_URL_SECONDS = 10 * 60;

/** Where an application's resume file lives: its bucket and the client that may sign it. */
type ResumeFile = { path: string; sign: ReturnType<ReturnType<typeof createServiceRoleClient>["storage"]["from"]> };

/**
 * An application's resume: the one the applicant applied with, or for a
 * company candidate (BI-REQ-030) the file the company imported. Signed only
 * after RLS let the viewer read the application, as the candidate page does
 * (the company candidate bucket has no policies).
 */
export default async function ApplicationResumePage({ params }: { params: Promise<{ application_id: string }> }) {
  try {
    const { application_id } = await params;
    const frame = await loadApplicationFrame(application_id);
    if (!frame) notFound();
    const { supabase, person, application } = frame;

    let file: ResumeFile | null = null;
    if (person.kind === "user") {
      const { data, error } = await supabase
        .from("applications")
        .select("resumes(resume_path)")
        .eq("id", application_id)
        .maybeSingle();
      if (error) throw error;
      const path = data?.resumes?.resume_path;
      if (path) file = { path, sign: supabase.storage.from("resumes") };
    }
    // A company candidate's file, claimed or not (BIT-101).
    const importedPath = application.company_candidates?.resume_path;
    if (!file && importedPath) {
      file = { path: importedPath, sign: createServiceRoleClient().storage.from(RESUME_BUCKET) };
    }

    let url: string | null = null;
    let downloadUrl: string | null = null;
    if (file) {
      const name = `${person.name.replace(/[^\w .-]+/g, "").trim() || "resume"}.${resumeExtensionOf(file.path) ?? "pdf"}`;
      const [view, download] = await Promise.all([
        file.sign.createSignedUrl(file.path, SIGNED_URL_SECONDS),
        file.sign.createSignedUrl(file.path, SIGNED_URL_SECONDS, { download: name }),
      ]);
      if (view.error || download.error) reportError("Failed to sign the application's resume:", view.error ?? download.error);
      url = view.data?.signedUrl ?? null;
      downloadUrl = download.data?.signedUrl ?? null;
    }
    const isPdf = file?.path.toLowerCase().endsWith(".pdf") ?? false;

    return (
      <div className="mb-20 flex flex-col gap-6">
        <SectionHeader
          title="Resume"
          actions={
            // The PDF viewer has its own Download button.
            downloadUrl && !isPdf ? (
              <Button asChild variant="outline">
                <a href={downloadUrl}>
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </a>
              </Button>
            ) : undefined
          }
        />
        {!file ? (
          <p className="rounded-xl border p-6 text-sm text-muted-foreground">No resume with this application.</p>
        ) : !url ? (
          <p className="rounded-xl border p-6 text-sm text-muted-foreground">Couldn&apos;t load the resume. Reload to try again.</p>
        ) : isPdf ? (
          <OriginalResumeWrapper url={url} downloadUrl={downloadUrl ?? undefined} />
        ) : (
          <p className="rounded-xl border p-6 text-sm text-muted-foreground">
            Word files can&apos;t be shown here. Download it to read it.
          </p>
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
