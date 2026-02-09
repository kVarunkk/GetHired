import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import BackButton from "@/components/BackButton";
import CreateReviewForResume from "@/components/CreateReviewForResume";
import { Badge } from "@/components/ui/badge";
import InfoTooltip from "@/components/InfoTooltip";
import { TAICredits } from "@/lib/types";
import Link from "next/link";
// import dynamic from "next/dynamic";
import OriginalResumeWrapper from "@/components/OriginalResumeWrapper";
// import OriginalResumeViewer from "@/components/OriginalResumeViewer";

export default async function ResumeIdPage({
  params,
}: {
  params: Promise<{ resumeId: string }>;
}) {
  const { resumeId } = await params;
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("resumes")
      .select("*")
      .eq("id", resumeId)
      .single();

    if (!data || error) {
      throw new Error("Resume not found");
    }

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
            <h1 className="text-2xl font-medium truncate">{data.name}</h1>
            {data.is_primary && <Badge>PRIMARY</Badge>}
          </div>
          {user?.id && (
            <div className="flex items-center gap-1">
              <CreateReviewForResume userId={user.id} resumeId={resumeId} />
              <InfoTooltip
                content={
                  <p>
                    This feature uses {TAICredits.AI_CV_REVIEW} AI credits per
                    use.{" "}
                    <Link href={"/dashboard"} className="text-blue-500">
                      Recharge Credits
                    </Link>
                  </p>
                }
              />
            </div>
          )}
        </div>
        <OriginalResumeWrapper url={signedUrlData?.signedUrl} />
      </div>
    );
  } catch {
    return <ErrorComponent />;
  }
}
