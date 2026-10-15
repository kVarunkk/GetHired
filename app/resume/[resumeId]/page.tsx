import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import BackButton from "@/components/BackButton";
import { Badge } from "@/components/ui/badge";
import OriginalResumeWrapper from "@/components/OriginalResumeWrapper";
import InfoTooltip from "@/components/InfoTooltip";
import CreateReviewForResume from "@/components/CreateReviewForResume";
import { RetryResumeParsing } from "@/components/RetryResumeParsing";
import ResumeStatusBadge from "@/components/ResumeStatusBadge";
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
      <div className="flex flex-col w-full gap-4 p-4 mb-20 ">
        <div>
          <BackButton />
        </div>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight truncate">
              {data.name}
            </h1>
            {data.is_primary && <Badge variant="brand">PRIMARY</Badge>}
            {data.is_primary && (
              <InfoTooltip
                content={
                  <p>
                    This resume will be used for building your job digest and ai
                    smart search job feed.
                  </p>
                }
              />
            )}
            <ResumeStatusBadge
              isParsed={!!data.content}
              isParsingFailed={isParsingFailed}
            />
          </div>
          {user?.id && (
            <div className="flex items-center gap-4">
              {isParsingFailed && <RetryResumeParsing resumeId={resumeId} />}
              <div className="flex items-center gap-1">
                <CreateReviewForResume userId={user.id} resumeId={resumeId} />
              </div>
            </div>
          )}
        </div>
        <OriginalResumeWrapper url={signedUrlData?.signedUrl} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
