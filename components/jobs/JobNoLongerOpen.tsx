import Link from "next/link";
import { Button } from "@/components/ui/button";
import MyApplicationLink from "./MyApplicationLink";

/** The one copy for a paused, closed or filled job (JL-REQ-028). */
export const JOB_NO_LONGER_OPEN = "This job is no longer accepting applications.";

/**
 * What the public job page and the careers job page show for a job that was
 * open and isn't any more. Paused, closed and filled read the same, so an
 * applicant never learns which, or why (JL-SEC-005). Someone who applied also
 * gets a link to their application in My Jobs.
 */
export default function JobNoLongerOpen({
  jobId,
  jobName,
  companyName,
  browseHref,
  browseLabel,
}: {
  jobId: string;
  jobName: string;
  companyName: string;
  browseHref: string;
  browseLabel: string;
}) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{jobName}</h1>
        {companyName && <p className="text-sm text-muted-foreground">{companyName}</p>}
      </div>
      <p role="status" className="text-sm">
        {JOB_NO_LONGER_OPEN}
      </p>
      <div className="flex flex-wrap gap-2">
        <MyApplicationLink jobId={jobId} />
        <Button asChild variant="outline">
          <Link href={browseHref}>{browseLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
