import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import { AskAgentAboutStages } from "@/components/agent/recruiter/AskAgentAboutSettings";
import NewPipelineDialog from "@/components/pipeline/NewPipelineDialog";
import PipelinesTable from "@/components/pipeline/PipelinesTable";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, forbiddenMessage } from "@/helpers/companies/permissions";
import { MAX_PIPELINES_PER_COMPANY } from "@/helpers/pipeline/config";
import { listPipelines } from "@/helpers/pipeline/pipelines";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pipelines",
};

/**
 * Settings → Pipelines, the settings index (JPT-032, JP-REQ-001/008): the
 * company's pipelines, each with its jobs and stages. A row opens its stage
 * editor (`/company/settings/pipelines/[id]`). Read-only without
 * settings.stages (RP-REQ-016); the actions check again.
 */
export default async function CompanySettingsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();

    const pipelines = await listPipelines({ supabase, company });
    const canManage = can(company, "settings.stages");

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Pipelines"
          description="The stages of each job's board. Every job uses one pipeline; new jobs get the default."
          actions={
            canManage && (
              <NewPipelineDialog
                atLimit={pipelines.length >= MAX_PIPELINES_PER_COMPANY}
                canUseAgent={can(company, "agent.use")}
                sources={pipelines.map((p) => ({ id: p.id, name: p.name, isDefault: p.is_default }))}
              />
            )
          }
        />

        {can(company, "agent.use") && (
          <AskAgentAboutStages
            canViewStages={can(company, "applicants.view")}
            canEditStages={canManage}
          />
        )}

        {!canManage && (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {forbiddenMessage("settings.stages")}
          </p>
        )}

        <PipelinesTable
          canManage={canManage}
          pipelines={pipelines.map((p) => ({
            id: p.id,
            name: p.name,
            isDefault: p.is_default,
            jobs: p.jobs,
            activeStages: p.activeStages,
          }))}
        />
        {canManage && (
          <p className="text-xs text-muted-foreground">
            {pipelines.length} of {MAX_PIPELINES_PER_COMPANY} pipelines used.
          </p>
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
