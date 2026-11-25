import { Badge } from "@/components/ui/badge";
import { JOB_STATE_BADGE, JOB_STATE_LABEL, type JobPostState } from "@/helpers/jobs/job-states";

/** A job post's lifecycle state (JL-REQ-029), in theme tokens only. */
export default function JobStateBadge({ state, className }: { state: JobPostState; className?: string }) {
  return (
    <Badge variant={JOB_STATE_BADGE[state]} className={className}>
      {JOB_STATE_LABEL[state]}
    </Badge>
  );
}
