import { toIsoCurrency } from "@/helpers/currency/currencies";
import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import Forbidden from "@/components/roles/Forbidden";
import JobPostingForm from "@/components/jobs/JobPostingForm";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { loadJobForm } from "@/helpers/jobs/load-job-form";
import { listPipelines } from "@/helpers/pipeline/pipelines";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Edit",
};

/**
 * A job's Edit section: the job post form with the stored values, the full
 * application form with its knockout rules and the answered questions
 * (AF-REQ-005). Needs jobs.edit on the job, like the action.
 */
export default async function EditJobPostPage({ params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params;
    if (!isUuid(job_id)) notFound();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company) notFound();
    if (!can(company, "jobs.edit", job_id)) return <Forbidden what="the job post editor" />;

    // Scoped to the session company: another company's job is a 404.
    const { data: job, error } = await supabase
      .from("job_postings")
      .select("*")
      .eq("id", job_id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    if (!job) notFound();
    const [loaded, pipelines, applications] = await Promise.all([
      loadJobForm(supabase, company.id, job.id),
      listPipelines({ supabase, company }),
      supabase.from("applications").select("id", { count: "exact", head: true }).eq("job_post_id", job.id),
    ]);
    if (!loaded) notFound();
    if (applications.error) throw applications.error;

    return (
      <div className="flex w-full flex-col gap-6">
        <SectionHeader title="Edit job post" description={`Change the details and application form of ${job.title}.`} />
        <JobPostingForm
          companyId={company.id}
          existingValues={{
            id: job.id,
            title: job.title,
            description: job.description ?? "",
            location: job.location ?? [],
            job_type: job.job_type,
            salary_currency: toIsoCurrency(job.salary_currency) ?? "USD",
            min_salary: job.min_salary ?? 0,
            max_salary: job.max_salary ?? 0,
            min_experience: job.min_experience ?? 0,
            max_experience: job.max_experience ?? 0,
            visa_sponsorship: job.visa_sponsorship ?? "Not Required",
            min_equity: job.min_equity ?? 0,
            max_equity: job.max_equity ?? 0,
            questions: job.questions ?? [],
            department: job.department ?? "",
            workplace_type: job.workplace_type ?? null,
            pipeline_id: job.pipeline_id ?? undefined,
          }}
          initialForm={loaded.form}
          answeredQuestionIds={loaded.answeredQuestionIds}
          cancelHref={`/company/job-posts/${job.id}`}
          pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, isDefault: p.is_default }))}
          hasApplications={(applications.count ?? 0) > 0}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
