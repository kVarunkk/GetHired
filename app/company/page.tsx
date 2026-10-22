import { reportError } from "@/helpers/posthog/report-error";
import { createClient } from "@/lib/supabase/server";
import { getMyCareersLink } from "@/helpers/careers/my-careers-link";
import CareersLinkBar from "@/components/careers/CareersLinkBar";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { jobControls, scopeToJobs } from "@/helpers/companies/job-scope";
import { NO_MEMBERSHIP } from "@/helpers/companies/require-company";
import ErrorComponent from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { CreateJobPostButton } from "@/components/jobs/JobPostButtons";
import { Button } from "@/components/ui/button";
import CompanyJobPostingCard from "@/components/CompanyJobPostingCard";
import ApplicationStatusBadge from "@/components/ApplicationStatusBadge";
import { TApplicationStatus } from "@/utils/types";
import { RECRUITER_CANDIDATE_COLUMNS } from "@/helpers/profiles/candidate-columns";
import AskRecruiterAgent from "@/components/agent/recruiter/AskRecruiterAgent";
import FunnelStrip from "@/components/pipeline/FunnelStrip";
import {
  NEEDS_ATTENTION_DAYS,
  getCompanyFunnel,
  type CompanyFunnel,
} from "@/helpers/pipeline/funnel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Company Dashboard",
  description:
    "Your job posts, applicants and matched candidates.",
};

export default async function CompanyPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    const companyInfo = await getMyCompany(supabase, user);
    if (!companyInfo) {
      // Onboarded but no membership: removed from their company (teams
      // difference 14). A new invite works, since the account is free again.
      if (user.app_metadata?.onboarding_complete) {
        return (
          <div className="mx-auto w-full max-w-md p-4 py-12">
            <div className="rounded-xl border p-6">
              <h1 className="text-2xl font-semibold tracking-tight">No company</h1>
              <p className="mt-3 text-sm text-muted-foreground">{NO_MEMBERSHIP}</p>
            </div>
          </div>
        );
      }
      throw new Error("Company profile not found");
    }
    // RP-REQ-016: job controls follow the viewer's permissions; the server refuses them too.
    const canCreateJobs = can(companyInfo, "jobs.create");
    // CP-REQ-014: the careers page link on the dashboard.
    const careersLink = await getMyCareersLink(supabase, companyInfo.id).catch(() => null);

    const [metricsRes, jobsRes, applicantsRes] = await Promise.all([
      supabase.rpc("get_company_metrics", { company_id: companyInfo.id }),
      scopeToJobs(
        supabase
        .from("job_postings")
        .select(
          `
          id,
          title,
          company_id,
          description,
          location,
          job_type,
          salary_currency,
          salary_range,
          equity_range,
          experience,
          min_salary,
          max_salary,
          min_experience,
          max_experience,
          visa_sponsorship,
          min_equity,
          max_equity,
          questions,
          department,
          workplace_type,
          status,
          job_id,
          updated_at,
          applications(id),
          company_info(name, website)
        `,
        )
        .eq("company_id", companyInfo.id),
        companyInfo,
      )
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("applications")
        .select(
          `
          id,
          status,
          created_at,
          user_info(${RECRUITER_CANDIDATE_COLUMNS}),
          job_postings(id, title)
        ` as const,
        )
        .eq("job_postings.company_id", companyInfo.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const { data: metricsData, error: metricsError } = metricsRes;
    const { data: jobsData, error: jobsError } = jobsRes;
    const { data: applicantsData, error: applicantsError } = applicantsRes;

    if (metricsError || jobsError || applicantsError) {
      throw new Error("Failed to fetch dashboard data.");
    }

    const metrics = metricsData?.[0] || {};
    const jobPosts = jobsData || [];
    const recentApplicants = applicantsData || [];

    // The pipeline section (PL-TASK-050). It's extra: a failure hides it
    // instead of the whole dashboard.
    let funnel: CompanyFunnel | null = null;
    try {
      funnel = await getCompanyFunnel({
        supabase,
        company: companyInfo,
      });
    } catch (err) {
      reportError("Failed to load the company funnel:", err);
    }

    return (
      <div className="flex flex-col w-full gap-5 p-4 mb-20">
        <PageHeader
          title={`How are you doing today, ${companyInfo.name}?`}
          actions={
            <CreateJobPostButton disabled={!canCreateJobs} />
          }
        />

        {can(companyInfo, "agent.use") && <AskRecruiterAgent />}

        {careersLink && <CareersLinkBar slug={careersLink.slug} published={careersLink.published} />}

        {/* --- Metrics Section --- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="flex flex-col items-center p-6 text-center">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight">
                {metrics.total_jobs || 0}
              </CardTitle>
              <p className="text-sm text-muted-foreground font-medium">
                Job Posts
              </p>
            </CardContent>
          </Card>

          <Card className="flex flex-col items-center p-6 text-center">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight">
                {metrics.total_applicants || 0}
              </CardTitle>
              <p className="text-sm text-muted-foreground font-medium">
                Total Applicants
              </p>
            </CardContent>
          </Card>

          <Card className="flex flex-col items-center p-6 text-center">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-3xl font-semibold tracking-tight">
                {metrics.new_applicants_today || 0}
              </CardTitle>
              <p className="text-sm text-muted-foreground font-medium">
                New Applicants Today
              </p>
            </CardContent>
          </Card>
        </div>

        {/* --- Pipeline Section --- */}
        {funnel && funnel.jobs.length > 0 && (
          <div className="mt-8 flex flex-col gap-4">
            <h3 className="text-lg font-semibold tracking-tight">
              Pipeline across active jobs
            </h3>
            <FunnelStrip stages={funnel.stages} />
            {funnel.needsAttention.length > 0 && (
              <section
                aria-label="Needs attention"
                className="flex flex-col gap-2"
              >
                <h4 className="text-sm font-semibold">Needs attention</h4>
                <p className="text-sm text-muted-foreground">
                  In Applied for more than {NEEDS_ATTENTION_DAYS} days with
                  nothing logged since.
                </p>
                <ul className="divide-y rounded-xl border">
                  {funnel.needsAttention.map((item) => (
                    <li
                      key={item.applicationId}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                    >
                      <span>
                        <Link
                          href={`/company/applications/${item.applicationId}`}
                          className="font-medium hover:underline"
                        >
                          {item.name}
                        </Link>
                        <span className="text-muted-foreground">
                          {" for "}
                          <Link
                            href={`/company/job-posts/${item.jobPostId}/applications`}
                            className="hover:underline"
                          >
                            {item.jobTitle}
                          </Link>
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        {item.daysInApplied} days in Applied
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* --- Active Job Posts Section --- */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold tracking-tight">
              Your Job Posts
            </h3>
            <Link href={"/company/job-posts"}>
              <Button variant={"ghost"}>View all</Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobPosts.length > 0 ? (
              jobPosts.map((job) => (
                <CompanyJobPostingCard
                  key={job.id}
                  job={job}
                  controls={jobControls(companyInfo, job.id)}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                You have no active job posts.
              </p>
            )}
          </div>
        </div>

        {/* --- Recent Applications Section --- */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold tracking-tight">
              Recent Applications
            </h3>
            <Link href={"/company/applications"}>
              <Button variant={"ghost"}>View all</Button>
            </Link>
          </div>
          {recentApplicants.length > 0 ? (
            <ul className="divide-y rounded-xl border">
              {recentApplicants.map((applicant) => (
                <li
                  key={applicant.id}
                  className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Link
                      href={`/company/applications/${applicant.id}`}
                      className="font-medium underline underline-offset-4 transition-colors hover:text-brand sm:no-underline"
                    >
                      {applicant.user_info?.full_name || "New Applicant"}
                    </Link>
                    <div className="text-muted-foreground text-sm">
                      Applied for{" "}
                      <Link
                        href={`/company/job-posts/${applicant.job_postings?.id}`}
                        className="underline underline-offset-4 sm:no-underline font-medium hover:underline"
                      >
                        {applicant.job_postings?.title}
                      </Link>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                    <ApplicationStatusBadge
                      status={applicant.status as TApplicationStatus}
                    />
                    <div>
                      {formatDistanceToNow(new Date(applicant.created_at), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No recent applications.
            </p>
          )}
        </div>
      </div>
    );
  } catch (error) {
    reportError("[company] dashboard failed", error);
    return <ErrorComponent />;
  }
}
