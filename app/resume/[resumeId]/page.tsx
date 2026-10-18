import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import OriginalResumeWrapper from "@/components/OriginalResumeWrapper";
import InfoTooltip from "@/components/InfoTooltip";
import CreateReviewForResume from "@/components/CreateReviewForResume";
import { RetryResumeParsing } from "@/components/RetryResumeParsing";
import ResumeStatusBadge from "@/components/ResumeStatusBadge";
import { AskAgentAboutResume } from "@/components/agent/AskAgentOnApplicantIdPages";
import { notFound, unstable_rethrow } from "next/navigation";
import { isUuid } from "@/helpers/agent/auth";

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

    const { data, error } = await supabase
      .from("resumes")
      .select("*")
      .eq("id", resumeId)
      .maybeSingle();

    if (error) throw error;
    if (!data) notFound();

    const isParsingFailed = data.parsing_failed === true;

    const { data: signedUrlData, error: signedUrlError } =
      await supabase.storage
        .from("resumes")
        .createSignedUrl(`${data?.resume_path}`, 3600);

    if (signedUrlError || !signedUrlData) {
      throw new Error("Could not get signed URL for resume.");
    }

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
              <ResumeStatusBadge
                isParsed={!!data.content}
                isParsingFailed={isParsingFailed}
              />
            </div>
          }
          actions={
            user?.id && (
              <>
                {isParsingFailed && <RetryResumeParsing resumeId={resumeId} />}
                <CreateReviewForResume userId={user.id} resumeId={resumeId} />
              </>
            )
          }
        />
        {user?.app_metadata.type === "applicant" && (
          <AskAgentAboutResume
            resume={{
              id: data.id,
              name: data.name ?? "Untitled resume",
              isPrimary: data.is_primary === true,
              parsingFailed: isParsingFailed,
            }}
          />
        )}
        <OriginalResumeWrapper url={signedUrlData?.signedUrl} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
