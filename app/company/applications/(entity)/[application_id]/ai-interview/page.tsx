import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { Settings } from "lucide-react";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import InterviewReport from "@/components/interviews/InterviewReport";
import InviteToInterviewButton from "@/components/interviews/InviteToInterviewButton";
import MarkReviewedButton from "@/components/interviews/MarkReviewedButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadApplicationFrame, loadApplicationInterview } from "@/helpers/applications/application-page";
import { isReviewed } from "@/helpers/interview/screening/reviewed";
import { DEFAULT_DURATION_MINUTES } from "@/helpers/interview/screening/schemas";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Interview",
};

/**
 * SIT-063: an application's AI interview section, for interviews.view on the
 * job. It shows even when the job's AI interview is off, with a link to the
 * job's AI interview page to turn it on. Inviting happens here; the actions on
 * an existing interview are in the layout's header (interviews.manage).
 */
export default async function ApplicationInterviewPage({ params }: { params: Promise<{ application_id: string }> }) {
  try {
    const { application_id } = await params;
    const [frame, { canView, canManage, interview, config }] = await Promise.all([
      loadApplicationFrame(application_id),
      loadApplicationInterview(application_id),
    ]);
    if (!frame?.jobId || !canView) notFound();

    const enabled = !!config?.enabled;
    // In a Rejected or Hired stage the invite RPC refuses with `closed`.
    let canInvite = !interview && enabled && canManage && !frame.mergedInto;
    if (canInvite && frame.application.stage_id) {
      const { data: stage } = await frame.supabase
        .from("pipeline_stages")
        .select("kind")
        .eq("id", frame.application.stage_id)
        .maybeSingle();
      canInvite = stage?.kind !== "rejected" && stage?.kind !== "hired";
    }
    const jobInterviewHref = `/company/job-posts/${frame.jobId}/interview`;

    const completedAt = interview?.status === "completed" ? interview.completedAt : null;
    const reviewed = !!completedAt && isReviewed(interview!.reviewedAt, completedAt);

    return (
      <div className="mb-20 flex flex-col gap-6">
        <SectionHeader
          title="AI interview"
          actions={
            (interview || enabled) && (
              <>
                {reviewed && <Badge variant="secondary">Reviewed</Badge>}
                {completedAt && !reviewed && canManage && <MarkReviewedButton interviewId={interview!.id} />}
                <Button asChild variant="outline" size="sm">
                  <Link href={jobInterviewHref}>
                    <Settings />
                    Job&apos;s AI interview settings
                  </Link>
                </Button>
              </>
            )
          }
        />
        {interview ? (
          <InterviewReport interview={interview} />
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-lg border p-6">
            <div className="flex flex-col gap-1">
              <p className="font-semibold">
                {enabled ? "Not invited yet" : "The AI interview is off for this job"}
              </p>
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? "This candidate hasn't been invited to the AI interview."
                  : "Turn it on from the job's AI interview page to invite candidates to a voice interview."}
              </p>
            </div>
            {canInvite && (
              <InviteToInterviewButton
                applicationId={frame.application.id}
                jobPostId={frame.jobId}
                candidateName={frame.person.name}
                durationMinutes={config?.duration_minutes ?? DEFAULT_DURATION_MINUTES}
                enabled={enabled}
              />
            )}
            {!enabled && (
              <Button asChild variant="brand" size="sm">
                <Link href={jobInterviewHref}>Set up the AI interview</Link>
              </Button>
            )}
          </div>
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
