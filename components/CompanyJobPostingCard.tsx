"use client";

import DeleteJobPosting from "@/components/DeleteJobPosting";
// import { IJobPosting } from "@/utils/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import CreateJobPostingDialog from "./CreateJobPostingDialog";
import { JobStatusSwitch } from "./JobPostingsTable";
import { TCompanyIdPageData } from "@/utils/types/jobs.types";

export default function CompanyJobPostingCard({
  job,
}: {
  job: TCompanyIdPageData;
}) {
  return (
    <Card className="p-4 shadow-none group">
      <CardHeader className="p-0 mb-2">
        <CardTitle className="text-lg font-bold flex items-center justify-between min-h-10">
          <Link
            className="hover:underline underline underline-offset-4 sm:no-underline"
            href={`/company/job-posts/${job.id}`}
          >
            {job.title}
          </Link>
          <div className="items-center gap-1 flex sm:hidden sm:group-hover:flex">
            <CreateJobPostingDialog
              key={`${job.id}-${job.updated_at ?? 0}`}
              companyId={job.company_id}
              existingValues={{
                id: job.id,
                title: job.title,
                description: job.description ?? "",
                location: job.location ?? [],
                job_type: job.job_type ?? undefined,
                salary_currency: job.salary_currency ?? "$",
                min_salary: job.min_salary ?? 0,
                max_salary: job.max_salary ?? 0,
                min_experience: job.min_experience ?? 0,
                max_experience: job.max_experience ?? 0,
                visa_sponsorship: job.visa_sponsorship ?? "Not Required",
                min_equity: job.min_equity ?? 0,
                max_equity: job.max_equity ?? 0,
                questions: job.questions ?? [],
                job_id: job.job_id,
              }}
            />
            <DeleteJobPosting job_posting_id={job.id} />
          </div>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {job.location?.length > 0 ? job.location.join(", ") : "Remote"}
        </p>
      </CardHeader>
      <CardContent className="p-0 flex items-center justify-between w-full">
        <div className="text-muted-foreground text-sm">
          <span className="font-semibold text-gray-900 dark:text-white">
            {job.applications?.length || 0}
          </span>{" "}
          Applicant{job.applications?.length !== 1 ? "s" : ""}
        </div>
        <JobStatusSwitch job={job} />
      </CardContent>
    </Card>
  );
}
