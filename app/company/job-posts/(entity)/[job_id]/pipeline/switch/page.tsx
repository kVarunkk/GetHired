import { notFound, unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import PipelineSwitchForm from "@/components/pipeline/PipelineSwitchForm";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, forbiddenMessage } from "@/helpers/companies/permissions";
import { jobPipelinePath } from "@/helpers/jobs/paths";
import { MAX_PIPELINES_PER_COMPANY } from "@/helpers/pipeline/config";
import { listPipelines } from "@/helpers/pipeline/pipelines";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Change pipeline",
};

/**
 * JPT-036 (JP-REQ-006): moves the job and its candidates to another pipeline,
 * for jobs.edit on the job (a 404 without it). `?to=` preselects a pipeline
 * (the job form's notice links here with it). With settings.stages the
 * list ends with "New pipeline…", which creates one and comes back here with
 * it picked, so the page works even when there's no other pipeline yet.
 */
export default async function JobPipelineSwitchPage({
  params,
  searchParams,
}: {
  params: Promise<{ job_id: string }>;
  searchParams: Promise<{ to?: string | string[] }>;
}) {
  try {
    const [{ job_id }, { to }] = await Promise.all([params, searchParams]);
    if (!isUuid(job_id)) notFound();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company || !can(company, "jobs.edit", job_id)) notFound();

    const { data: job, error } = await supabase
      .from("job_postings")
      .select("id, pipeline_id")
      .eq("id", job_id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    if (!job) notFound();

    const pipelines = await listPipelines({ supabase, company });
    const current = pipelines.find((p) => p.id === job.pipeline_id);
    if (!current) throw new globalThis.Error("The job's pipeline wasn't found.");
    const others = pipelines.filter((p) => p.id !== current.id).map(({ id, name }) => ({ id, name }));
    const picked = typeof to === "string" && others.some((p) => p.id === to) ? to : null;
    const canCreate = can(company, "settings.stages");

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          backHref={jobPipelinePath(job.id)}
          backLabel="Back to pipeline"
          title="Change pipeline"
          description="Moves this job and its candidates to another pipeline. Each stage's candidates go to a stage that shows them the same status."
        />
        {others.length > 0 || canCreate ? (
          <PipelineSwitchForm
            // A new pipeline comes back as ?to=; remount so it's picked.
            key={picked ?? "none"}
            jobPostId={job.id}
            current={{ id: current.id, name: current.name }}
            pipelines={others}
            initialTargetId={picked}
            newPipeline={
              canCreate
                ? {
                    sources: pipelines.map((p) => ({ id: p.id, name: p.name, isDefault: p.is_default })),
                    atLimit: pipelines.length >= MAX_PIPELINES_PER_COMPANY,
                    canUseAgent: can(company, "agent.use"),
                  }
                : undefined
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            There&apos;s no other pipeline yet. {forbiddenMessage("settings.stages")}
          </p>
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
