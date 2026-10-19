import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import Forbidden from "@/components/roles/Forbidden";
import JobPostingForm from "@/components/jobs/JobPostingForm";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { formFromLegacyQuestions } from "@/helpers/jobs/application-form-schema";
import { createClient } from "@/lib/supabase/server";

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
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
