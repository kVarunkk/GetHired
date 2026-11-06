import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import OriginalResumeWrapper from "@/components/OriginalResumeWrapper";
import InfoTooltip from "@/components/InfoTooltip";
import CreateReviewForResume from "@/components/CreateReviewForResume";
import { RetryResumeParsing } from "@/components/RetryResumeParsing";
import ResumeStatusBadge from "@/components/ResumeStatusBadge";
import ResumeHeaderActions from "@/components/resume/ResumeHeaderActions";
import ResumePreview from "@/components/resume/ResumePreview";
import { AskAgentAboutResume } from "@/components/agent/AskAgentOnApplicantIdPages";
import { buildResumeDocument } from "@/helpers/resume/render/document";
import { readResume } from "@/helpers/resume/read-resume";
import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { isUuid } from "@/helpers/agent/auth";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resume",
  robots: { index: false, follow: false },
};

export default async function ResumeIdPage({
  params,
}: {
  params: Promise<{ resumeId: string }>;
}) {
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
      .select("*")
      .eq("id", resumeId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) notFound();

    const resume = readResume(data);
    const isParsingFailed = data.parsing_failed === true;
    const isVersion1 = resume.schemaVersion === 1;

    // RE-REQ-031: a version 1 resume shows its PDF until it's upgraded. Anything
    // else has no file to sign (RE-REQ-100).
    let signedUrl: string | null = null;
    if (isVersion1 && data.resume_path) {
      const { data: signedUrlData, error: signedUrlError } =
        await supabase.storage
          .from("resumes")
          .createSignedUrl(data.resume_path, 3600);

      if (signedUrlError || !signedUrlData) {
        throw new Error("Could not get signed URL for resume.");
      }
      signedUrl = signedUrlData.signedUrl;
    }

    // RE-REQ-098/103: with no content and no file there is nothing to show, edit,
    // copy or export, so the file is asked for again. A version 1 resume with a
    // file is still readable, and prints "Older format".
    const needsUpload = !resume.hasContent && !signedUrl;

    return (
      <div className="flex flex-col w-full gap-6 p-4 mb-20">
        <PageHeader
          backHref="/resume"
          backLabel="Back to resumes"
          title={data.name}
          description={
            <div className="flex flex-wrap items-center gap-2">
              {data.is_primary && <Badge variant="brand">PRIMARY</Badge>}
              {data.is_primary && (
                <InfoTooltip
                  content={
                    <p>
                      This resume will be used for building your job digest and
                      ai smart search job feed.
                    </p>
                  }
                />
              )}
              {isVersion1 && (
                <ResumeStatusBadge
                  isParsed={resume.hasContent}
                  isParsingFailed={isParsingFailed}
                />
              )}
            </div>
          }
          actions={
            <>
              {isParsingFailed && signedUrl && <RetryResumeParsing resumeId={resumeId} />}
              {resume.hasContent && <ResumeHeaderActions resumeId={resumeId} />}
              <CreateReviewForResume userId={user.id} resumeId={resumeId} />
            </>
          }
        />
        {user.app_metadata.type === "applicant" && (
          <AskAgentAboutResume
            resume={{
              id: data.id,
              name: data.name ?? "Untitled resume",
              isPrimary: data.is_primary === true,
              parsingFailed: isParsingFailed,
            }}
          />
        )}
        {signedUrl ? (
          <OriginalResumeWrapper url={signedUrl} />
        ) : needsUpload ? (
          <Alert>
            <AlertTitle>This resume needs uploading again</AlertTitle>
            <AlertDescription>
              We no longer have a file for it.
              <Button asChild variant="outline" size="sm" className="mt-3 block w-fit">
                <Link href={`/resume/${resumeId}/edit`}>Upload it again</Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <ResumePreview
            className="mx-auto max-w-3xl"
            document={buildResumeDocument({
              contact: resume.contact ?? { fullName: "", links: [] },
              content: resume.content,
              template: resume.template,
            })}
          />
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
