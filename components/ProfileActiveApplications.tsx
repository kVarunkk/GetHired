"use client";

import { formatDate } from "@/utils/date";
import { Button } from "./ui/button";
import ApplicationStatusBadge from "./ApplicationStatusBadge";
import { ArrowRight } from "lucide-react";
import ModifiedLink from "./ModifiedLink";
import { TApplicantProfile } from "@/utils/types/user.types";
import { TApplicationStatus } from "@/utils/types";

/** One of the candidate's applications to this company's jobs. */
export default function ProfileActiveApplication({
  app,
}: {
  app: TApplicantProfile["applications"][number];
}) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ModifiedLink
          href={`/company/job-posts/${app.job_postings?.id}`}
          className="truncate text-sm font-medium hover:underline"
        >
          {app.job_postings?.title}
        </ModifiedLink>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ApplicationStatusBadge status={app.status as TApplicationStatus} />
          <span>Applied {formatDate(app.created_at, { dateStyle: "medium" }, "en-US")}</span>
        </div>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <ModifiedLink
          href={`/company/applicants/${app.id}`}
          aria-label={`View application for ${app.job_postings?.title ?? "this job"}`}
        >
          View<span className="hidden sm:inline"> application</span>
          <ArrowRight className="h-4 w-4" />
        </ModifiedLink>
      </Button>
    </li>
  );
}
