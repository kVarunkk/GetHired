import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import { AskAgentAboutStages } from "@/components/agent/recruiter/AskAgentAboutSettings";
import SettingsCard from "@/components/pipeline/SettingsCard";
import StageEditor from "@/components/pipeline/StageEditor";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { PIPELINES_SETTINGS_PATH } from "@/helpers/pipeline/config";
import { listPipelines } from "@/helpers/pipeline/pipelines";
import { listPipelineStages } from "@/helpers/pipeline/stages";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pipeline Stages",
};

/**
 * Settings → Pipelines → one pipeline's stages (JPT-033, JP-REQ-002/008).
 * Another company's, an archived or an unknown pipeline is a 404. Read-only
 * without settings.stages (RP-REQ-016); the action checks again.
 */
export default async function PipelineStagesPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) notFound();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();

    const pipeline = (await listPipelines({ supabase, company })).find((p) => p.id === id);
    if (!pipeline) notFound();
    const stages = await listPipelineStages({ supabase, company }, pipeline.id);

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          backHref={PIPELINES_SETTINGS_PATH}
          backLabel="Back to pipelines"
          title={pipeline.name}
          description={
            pipeline.is_default
              ? "The default pipeline: new jobs get it. Each stage shows candidates one of their statuses."
              : "Each stage shows candidates one of their statuses."
          }
        />

        {/* The agent's stage tools take this pipeline's id (JPT-037/040). */}
        {can(company, "agent.use") && (
          <AskAgentAboutStages
            canViewStages={can(company, "applicants.view")}
            canEditStages={can(company, "settings.stages")}
            pipeline={{ id: pipeline.id, name: pipeline.name }}
          />
        )}

        <SettingsCard company={company} permission="settings.stages">
          <StageEditor
            pipelineId={pipeline.id}
            sharedByJobs={pipeline.jobs}
            stages={stages.map(({ id: stageId, name, kind }) => ({ id: stageId, name, kind }))}
          />
        </SettingsCard>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
