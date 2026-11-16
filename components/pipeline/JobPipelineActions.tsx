"use client";

import { useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { forkJobPipelineAction } from "@/app/actions/pipeline/fork-job-pipeline";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { jobPipelineSwitchPath } from "@/helpers/jobs/paths";

/** Shown on "Change pipeline" when the company has no other active pipeline. */
export const NO_OTHER_PIPELINE = "There's no other pipeline yet. Create one in Settings → Pipelines.";

/**
 * The job's Pipeline section actions (JPT-035): "Change pipeline" (jobs.edit
 * on the job) opens the switch page; "Customize for this job" (settings.stages)
 * asks, forks the pipeline and opens the copy's stage editor. The page passes
 * the permission booleans; the actions check again.
 */
export default function JobPipelineActions({
  jobPostId,
  pipelineName,
  canSwitch,
  canCustomize,
  hasOtherPipelines,
}: {
  jobPostId: string;
  pipelineName: string;
  canSwitch: boolean;
  canCustomize: boolean;
  hasOtherPipelines: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  async function customize() {
    let result: Awaited<ReturnType<typeof forkJobPipelineAction>>;
    try {
      result = await forkJobPipelineAction({ jobPostId });
    } catch (err) {
      // On success the action redirects to the new pipeline's editor: Next
      // applies the navigation, then rejects the action's promise with it.
      if (!isRedirectError(err)) throw err;
      result = undefined;
    }
    if (result) {
      toast.error(result.error);
      return false;
    }
    toast.success("This job now has its own pipeline.");
  }

  if (!canSwitch && !canCustomize) return null;
  return (
    <>
      {canCustomize && (
        <Button variant="outline" onClick={() => setConfirming(true)}>
          Customize for this job
        </Button>
      )}
      {canSwitch &&
        // With settings.stages the switch page can create the other pipeline.
        (hasOtherPipelines || canCustomize ? (
          <Button asChild variant="brand">
            <Link href={jobPipelineSwitchPath(jobPostId)}>Change pipeline</Link>
          </Button>
        ) : (
          // A disabled button doesn't show a title, so the wrapper carries it.
          <span title={NO_OTHER_PIPELINE}>
            <Button variant="brand" disabled>
              Change pipeline
            </Button>
          </span>
        ))}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Customize this job's pipeline?"
        description={`This copies ${pipelineName} into a new pipeline that only this job uses, and moves its candidates to the matching stages. Other jobs keep ${pipelineName}. Candidates won't see a change and won't be emailed.`}
        confirmLabel="Customize"
        confirmVariant="brand"
        onConfirm={customize}
      />
    </>
  );
}
