import Link from "next/link";
import { CreateJobPostButton } from "@/components/jobs/JobPostButtons";
import JobStateBadge from "@/components/jobs/JobStateBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { OpenJob } from "@/helpers/company-dashboard/load";
import { JOB_POSTS_PATH, jobPostPath } from "@/helpers/jobs/paths";

/** CD-REQ-027: up to 5 open and paused jobs, one line each. */
export default function OpenJobsCard({ jobs, canCreate }: { jobs: OpenJob[]; canCreate: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Open jobs</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href={JOB_POSTS_PATH}>View all</Link>
          </Button>
        </div>

        {jobs.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">No open job posts</p>
            {canCreate && <CreateJobPostButton />}
          </div>
        ) : (
          <ul className="flex flex-col divide-y">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    href={jobPostPath(job.id)}
                    className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {job.title}
                  </Link>
                  {(job.state === "paused" || job.linkOnly) && (
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      {job.state === "paused" && <JobStateBadge state={job.state} />}
                      {job.linkOnly && <Badge variant="outline">Link only</Badge>}
                    </div>
                  )}
                </div>
                {job.applicants && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {`${job.applicants.total} ${job.applicants.total === 1 ? "applicant" : "applicants"} · ${job.applicants.newThisWeek} new in 7 days`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
