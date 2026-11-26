import { notFound, unstable_rethrow } from "next/navigation";
import { Download } from "lucide-react";
import Error from "@/components/Error";
import OriginalResumeWrapper from "@/components/OriginalResumeWrapper";
import SectionHeader from "@/components/SectionHeader";
import CandidateResumeUpload from "@/components/candidates/CandidateResumeUpload";
import { Button } from "@/components/ui/button";
import { reportError } from "@/helpers/posthog/report-error";
import { loadCandidateFrame } from "@/helpers/candidates/candidate-page";
import { RESUME_BUCKET, resumeExtensionOf } from "@/helpers/candidates/resume-files";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resume",
};

/** How long the viewer's link to the file works. */
const SIGNED_URL_SECONDS = 10 * 60;

/**
 * A candidate's resume (BIT-049): the file, through a short-lived signed URL
 * made only after RLS let the viewer read the candidate (the bucket has no
 * policies), and an upload for members who can edit them.
 */
export default async function CandidateResumePage({ params }: { params: Promise<{ candidate_id: string }> }) {
  try {
    const { candidate_id } = await params;
    const frame = await loadCandidateFrame(candidate_id);
    if (!frame) notFound();
    const { candidate, canEdit } = frame;

    let url: string | null = null;
    let downloadUrl: string | null = null;
    if (candidate.resume_path) {
      const storage = createServiceRoleClient().storage.from(RESUME_BUCKET);
      const name = `${candidate.full_name.replace(/[^\w .-]+/g, "").trim() || "resume"}.${resumeExtensionOf(candidate.resume_path) ?? "pdf"}`;
      const [view, download] = await Promise.all([
        storage.createSignedUrl(candidate.resume_path, SIGNED_URL_SECONDS),
        storage.createSignedUrl(candidate.resume_path, SIGNED_URL_SECONDS, { download: name }),
      ]);
      if (view.error || download.error) reportError("Failed to sign the candidate's resume:", view.error ?? download.error);
      url = view.data?.signedUrl ?? null;
      downloadUrl = download.data?.signedUrl ?? null;
    }
    const isPdf = candidate.resume_path?.toLowerCase().endsWith(".pdf") ?? false;

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
        {canEdit && <CandidateResumeUpload candidateId={candidate.id} hasResume={!!candidate.resume_path} />}
        {!candidate.resume_path ? (
          <p className="rounded-xl border p-6 text-sm text-muted-foreground">
            No resume yet. Without one, fit screening can only score them from the details on their overview.
          </p>
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
