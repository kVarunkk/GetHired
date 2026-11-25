import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import JobMarkdown from "@/components/JobMarkdown";
import type { TJobIdPageData } from "@/utils/types/jobs.types";

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs font-medium text-muted-foreground">{label}</p>
    <p className="text-sm">{value}</p>
  </div>
);

/** AP-REQ-033: the job and company beside the apply form (the old dialog's left pane). */
export default function ApplyJobSummary({ job }: { job: TJobIdPageData }) {
  const companyDescription = job.job_postings?.[0]?.company_info?.description;
  return (
    <div className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Company Profile</CardTitle>
          {job.company_url && (
            <CardDescription>
              <Link
                href={job.company_url}
                target="_blank"
                rel="nofollow noopener noreferrer"
                className="flex items-center gap-1 underline underline-offset-[4px]"
              >
                Visit Company Page <ExternalLink className="h-4 w-4" />
              </Link>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <JobMarkdown>{companyDescription || "No description provided."}</JobMarkdown>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Job Details</CardTitle>
          <CardDescription className="text-sm font-medium">
            {job.job_type} | {(job.locations ?? []).join(", ")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Description</p>
            <JobMarkdown>{job.description || "No description provided."}</JobMarkdown>
          </div>
          {job.salary_range && <Detail label="Salary Range" value={job.salary_range} />}
          {job.experience && <Detail label="Experience" value={job.experience} />}
          {job.visa_requirement && <Detail label="Visa Requirement" value={job.visa_requirement} />}
          {job.equity_range && <Detail label="Equity" value={job.equity_range} />}
        </CardContent>
      </Card>
    </div>
  );
}
