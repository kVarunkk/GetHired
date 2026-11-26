import { notFound, unstable_rethrow } from "next/navigation";
import { AskAgentAboutChannels } from "@/components/agent/recruiter/AskAgentAboutDistribution";
import CompanyChannelsTable from "@/components/distribution/CompanyChannelsTable";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny, forbiddenMessage } from "@/helpers/companies/permissions";
import { loadCompanyChannels } from "@/helpers/distribution/load-job-distribution";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Distribution Settings",
};

/**
 * Settings → Distribution (MP-REQ-011): turns each job board on or off for all
 * the company's jobs. Open with distribution.view at any scope; the switches
 * need distribution.manage with scope `all` (the table disables them
 * otherwise, and the action checks again). A job leaves itself out of an
 * active channel on its own Distribution section.
 */
export default async function DistributionSettingsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company || !canAny(company, "distribution.view")) notFound();

    const channels = await loadCompanyChannels(supabase, company.id);
    const canManage = can(company, "distribution.manage");

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Distribution"
          description="Turn job boards on or off for all your jobs. Each job can still leave itself out of an active board."
        />
        {can(company, "agent.use") && <AskAgentAboutChannels canManage={canManage} />}
        {!canManage && (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            {forbiddenMessage("distribution.manage")}
          </p>
        )}
        <CompanyChannelsTable channels={channels} canManage={canManage} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
