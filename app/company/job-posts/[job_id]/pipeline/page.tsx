import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import type { Metadata } from "next";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import { AskAgentAboutJobPipeline } from "@/components/agent/recruiter/AskAgentAboutSettings";
import JobPipelineActions from "@/components/pipeline/JobPipelineActions";
import { Badge } from "@/components/ui/badge";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { pipelineEditorPath } from "@/helpers/pipeline/config";
import { listPipelines } from "@/helpers/pipeline/pipelines";
import { stagesForJob } from "@/helpers/pipeline/stages";
import { STAGE_KIND_LABELS } from "@/helpers/pipeline/status-map";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Pipeline",
};

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * JPT-035 (JP-REQ-003/007): a job's Pipeline section, for jobs.view on the
 * job. Shows the job's pipeline, its stages with how many candidates sit in
 * each, and how many jobs share it. "Change pipeline" needs jobs.edit on the
 * job, "Customize for this job" needs settings.stages.
 */
export default async function JobPipelinePage({ params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params;
    if (!isUuid(job_id)) notFound();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company || !can(company, "jobs.view", job_id)) notFound();

    const { data: job, error } = await supabase
      .from("job_postings")
      .select("id, title, pipeline_id")
      .eq("id", job_id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    if (!job) notFound();

    const [pipelines, stages, apps] = await Promise.all([
      listPipelines({ supabase, company }),
      stagesForJob(company.id, job.id),
      // Counted as the board does: merged applications left out.
      supabase.from("applications").select("stage_id").eq("job_post_id", job.id).is("merged_into_application_id", null),
    ]);
    if (apps.error) throw apps.error;
    const pipeline = pipelines.find((p) => p.id === job.pipeline_id);
    if (!pipeline) throw new globalThis.Error("The job's pipeline wasn't found.");

    const counts = new Map<string, number>();
    for (const app of apps.data ?? []) {
      if (app.stage_id) counts.set(app.stage_id, (counts.get(app.stage_id) ?? 0) + 1);
    }
    const others = pipeline.jobs - 1;
    const canSwitch = can(company, "jobs.edit", job.id) && pipelines.length > 1;
    const canCustomize = can(company, "settings.stages");

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Pipeline"
          description="The stages this job's candidates move through. Candidates see a status, never the stage names."
          actions={
            <JobPipelineActions
              jobPostId={job.id}
              pipelineName={pipeline.name}
              canSwitch={can(company, "jobs.edit", job.id)}
              canCustomize={canCustomize}
              hasOtherPipelines={pipelines.length > 1}
            />
          }
        />

        {can(company, "agent.use") && (
          <AskAgentAboutJobPipeline
            job={{ id: job.id, title: job.title }}
            pipelineName={pipeline.name}
            canSwitch={canSwitch}
            canCustomize={canCustomize}
            canViewStages={can(company, "applicants.view")}
          />
        )}

        <section aria-labelledby="job-pipeline-name" className="rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <h3 id="job-pipeline-name" className="truncate font-semibold">
                {pipeline.name}
              </h3>
              {pipeline.is_default && <Badge variant="outline">Default</Badge>}
            </div>
            <Link
              href={pipelineEditorPath(pipeline.id)}
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              {can(company, "settings.stages") ? "Edit stages" : "View pipeline"}
            </Link>
          </div>
          <p className="border-b px-4 py-2 text-sm text-muted-foreground">
            {others > 0
              ? `Used by ${plural(pipeline.jobs, "job")}. Changes to its stages apply to all of them.`
              : "Only this job uses this pipeline."}
          </p>
          <ol aria-label="Stages" className="divide-y">
            {stages.map((stage) => (
              <li key={stage.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{stage.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{STAGE_KIND_LABELS[stage.kind]}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {plural(counts.get(stage.id) ?? 0, "candidate")}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
