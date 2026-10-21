import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import { AskAgentAboutStages } from "@/components/agent/recruiter/AskAgentAboutSettings";
import SettingsCard from "@/components/pipeline/SettingsCard";
import StageEditor from "@/components/pipeline/StageEditor";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { listStages } from "@/helpers/pipeline/stages";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pipeline Stages",
};

/**
 * Settings → Pipeline stages, the settings index (PL-TASK-032): the columns
 * of every job's board. Read-only without settings.stages (RP-REQ-016); the
 * action checks again. The layout's sidebar links the other settings.
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

    const stages = await listStages({ supabase, company });

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Pipeline stages"
          description="The columns of every job's board. Each stage shows candidates one of their statuses."
        />

        {can(company, "agent.use") && (
          <AskAgentAboutStages
            canViewStages={can(company, "applicants.view")}
            canEditStages={can(company, "settings.stages")}
          />
        )}

        <SettingsCard company={company} permission="settings.stages">
          <StageEditor stages={stages.map(({ id, name, kind }) => ({ id, name, kind }))} />
        </SettingsCard>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
