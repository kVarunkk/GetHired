"use client";

// import { IApplication } from "@/utils/types";
// import { Link as ModifiedLink } from "react-transition-progress/next";
import { format } from "date-fns";
import { Button } from "./ui/button";
import ApplicationStatusBadge from "./ApplicationStatusBadge";
import { ArrowRight } from "lucide-react";
import ModifiedLink from "./ModifiedLink";
import { TApplicantProfile } from "@/utils/types/user.types";
import { TApplicationStatus } from "@/utils/types";

export default function ProfileActiveApplication({
  app,
}: {
  app: TApplicantProfile["applications"][number];
}) {
  return (
    <div className=" w-full  rounded-lg flex sm:items-center justify-between flex-col sm:flex-row gap-8 hover:bg-secondary transition py-2 px-3">
      <div className="flex flex-col gap-1">
        <p className=" text-sm">
          Applied for:{" "}
          <ModifiedLink
            href={`/jobs/${app.job_postings?.id}`}
            className="underline"
          >
            {app.job_postings?.title}
          </ModifiedLink>
        </p>
        <div className="text-sm text-muted-foreground">
          Applied on {format(new Date(app.created_at), "PPP")}
        </div>

        <ApplicationStatusBadge status={app.status as TApplicationStatus} />
      </div>
      <ModifiedLink href={`/company/applicants/${app.id}`}>
        <Button>
          View Application <ArrowRight className="h-4 w-4" />
        </Button>
      </ModifiedLink>
    </div>
  );
}
