"use client";

import DeleteJobPosting from "@/components/DeleteJobPosting";
// import { IJobPosting } from "@/utils/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { EditJobPostButton } from "./jobs/JobPostButtons";
import { JobStatusSwitch } from "./JobPostingsTable";
import { TCompanyIdPageData } from "@/utils/types/jobs.types";
import type { JobControls } from "@/helpers/companies/job-scope";

export default function CompanyJobPostingCard({
  job,
  controls = { edit: true, publish: true, delete: true },
}: {
  job: TCompanyIdPageData;
  /** What the viewer's role allows on this job (RP-REQ-016); the server checks again. */
  controls?: JobControls;
}) {
  return (
    <Card className="p-4 group transition-colors hover:bg-muted/60">
      <CardHeader className="p-0 mb-2">
        <CardTitle className="text-base font-semibold flex items-center justify-between min-h-10">
          <Link
            className="hover:underline underline underline-offset-4 sm:no-underline truncate"
            href={`/company/job-posts/${job.id}`}
          >
            {job.title}
          </Link>
          <div className="items-center gap-1 flex sm:hidden sm:group-hover:flex">
            <EditJobPostButton jobPostId={job.id} disabled={!controls.edit} />
            <DeleteJobPosting job_posting_id={job.id} disabled={!controls.delete} />
          </div>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {job.location?.length > 0 ? job.location.join(", ") : "Remote"}
        </p>
      </CardHeader>
      <CardContent className="p-0 flex items-center justify-between w-full">
        <div className="text-muted-foreground text-sm">
          <span className="font-medium text-foreground">
            {job.applications?.length || 0}
          </span>{" "}
          Application{job.applications?.length !== 1 ? "s" : ""}
        </div>
        <JobStatusSwitch job={job} disabled={!controls.publish} />
      </CardContent>
    </Card>
  );
}
