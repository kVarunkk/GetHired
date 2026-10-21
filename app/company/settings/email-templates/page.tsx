import { notFound, unstable_rethrow } from "next/navigation";
import { AskAgentAboutTemplates } from "@/components/agent/recruiter/AskAgentAboutSettings";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import SettingsCard from "@/components/pipeline/SettingsCard";
import TemplateEditor from "@/components/pipeline/TemplateEditor";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { actorName } from "@/helpers/pipeline/move";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Email Templates",
};

/**
 * Settings → Email templates (PL-TASK-032): what candidates get when they're
 * moved. Read-only without settings.templates (RP-REQ-016); the actions check
 * again.
 */
export default async function EmailTemplatesSettingsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();

    const [templatesResult, settingsResult] = await Promise.all([
      supabase
        .from("company_email_templates")
        .select("id, purpose, name, subject, body_md, is_default")
        .eq("company_id", company.id)
        .order("purpose", { ascending: true }),
      // For the preview's {{scheduling_link}}.
      supabase.from("company_info").select("scheduling_url").eq("id", company.id).single(),
    ]);
    if (templatesResult.error) throw templatesResult.error;
    if (settingsResult.error) throw settingsResult.error;

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Email templates"
          description="Sent from GetHired when you move candidates, with replies going to your company email."
        />
        {/* Every template tool needs settings.templates. */}
        {can(company, "agent.use") && can(company, "settings.templates") && <AskAgentAboutTemplates />}
        <SettingsCard company={company} permission="settings.templates">
          <TemplateEditor
            templates={templatesResult.data ?? []}
            sampleVars={{
              candidate_first_name: "Priya",
              job_title: "Backend Engineer",
              company_name: company.name,
              scheduling_link: settingsResult.data.scheduling_url,
              sender_name: actorName(user, company),
            }}
          />
        </SettingsCard>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
