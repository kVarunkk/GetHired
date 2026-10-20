import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import SchedulingLinkForm from "@/components/pipeline/SchedulingLinkForm";
import SettingsCard from "@/components/pipeline/SettingsCard";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { createClient } from "@/lib/supabase/server";

/**
 * Settings → Scheduling link (PL-TASK-040). Read-only without
 * settings.scheduling (RP-REQ-016); the action checks again.
 */
export default async function SchedulingSettingsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();

    const { data, error } = await supabase.from("company_info").select("scheduling_url").eq("id", company.id).single();
    if (error) throw error;

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Scheduling link"
          description="A Calendly, Cal.com or Google appointment link. Interview invites insert it as {{scheduling_link}}."
        />
        <SettingsCard company={company} permission="settings.scheduling">
          <SchedulingLinkForm initial={data.scheduling_url} />
        </SettingsCard>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
