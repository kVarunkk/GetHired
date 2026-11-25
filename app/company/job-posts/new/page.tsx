import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import Forbidden from "@/components/roles/Forbidden";
import { linkOnlyEnabled } from "@/helpers/jobs/link-only";
import JobPostingForm from "@/components/jobs/JobPostingForm";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { loadCompanyTimeZone } from "@/helpers/companies/load-time-zone";
import { can, canAny } from "@/helpers/companies/permissions";
import { formFromLegacyQuestions } from "@/helpers/jobs/application-form-schema";
import { loadJobApprovalRequired } from "@/helpers/jobs/job-approval";
import { listPipelines } from "@/helpers/pipeline/pipelines";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New Job Post",
  description:
    "Fill in the details for your new job opening.",
};

export const dynamic = "force-dynamic";

/** Job posts → New. Needs jobs.create (RP-REQ-002); the action checks it too. */
export default async function NewJobPostPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();
    if (!can(company, "jobs.create")) return <Forbidden what="the job post editor" />;
    const [pipelines, timeZone, approvalRequired] = await Promise.all([
      listPipelines({ supabase, company }),
      loadCompanyTimeZone(supabase, company.id),
      loadJobApprovalRequired(supabase, company.id),
    ]);

    // No bottom padding: the form's save bar sticks to the bottom edge.
    return (
      <div className="flex w-full flex-col gap-6 p-4 pb-0">
        <PageHeader
          backHref="/company/job-posts"
          backLabel="Back to job posts"
          title="New job post"
          description="Fill in the details for your new job opening."
        />
        <JobPostingForm
          companyId={company.id}
          initialForm={formFromLegacyQuestions([])}
          cancelHref="/company/job-posts"
          // RP-REQ-011: the creator is assigned to the new job, so a job-scoped
          // jobs.publish can open it.
          canPublish={canAny(company, "jobs.publish")}
          // JL-REQ-020: the same holds for a job-scoped jobs.approve.
          submitForApproval={approvalRequired && !canAny(company, "jobs.approve")}
          pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, isDefault: p.is_default }))}
          timeZone={timeZone}
          linkOnlyEnabled={linkOnlyEnabled()}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
