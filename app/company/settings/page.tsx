import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import StageEditor from "@/components/pipeline/StageEditor";
import TemplateEditor from "@/components/pipeline/TemplateEditor";
import SchedulingLinkForm from "@/components/pipeline/SchedulingLinkForm";
import NotificationSettings from "@/components/pipeline/NotificationSettings";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { actorName } from "@/helpers/pipeline/move";
import { listStages } from "@/helpers/pipeline/stages";
import { createClient } from "@/lib/supabase/server";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border p-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Company settings (PL-TASK-032, PL-TASK-040): pipeline stages, email
 * templates, the scheduling link and notifications.
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

    const [stages, templatesResult, settingsResult] = await Promise.all([
      listStages({ supabase, company }),
      supabase
        .from("company_email_templates")
        .select("id, purpose, name, subject, body_md")
        .eq("company_id", company.id)
        .order("purpose", { ascending: true }),
      supabase
        .from("company_info")
        .select("scheduling_url, notify_new_applicants, notify_weekly_matches")
        .eq("id", company.id)
        .single(),
    ]);
    if (templatesResult.error) throw templatesResult.error;
    if (settingsResult.error) throw settingsResult.error;
    const { scheduling_url: schedulingUrl, notify_new_applicants, notify_weekly_matches } = settingsResult.data;

    return (
      <div className="mb-20 flex w-full flex-col gap-6 p-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Settings</h1>

        <Section
          title="Pipeline stages"
          description="The columns of every job's board. Each stage shows candidates one of their statuses."
        >
          <StageEditor stages={stages.map(({ id, name, kind }) => ({ id, name, kind }))} />
        </Section>

        <Section
          title="Email templates"
          description="Sent from GetHired when you move candidates, with replies going to your company email."
        >
          <TemplateEditor
            templates={templatesResult.data ?? []}
            sampleVars={{
              candidate_first_name: "Priya",
              job_title: "Backend Engineer",
              company_name: company.name,
              scheduling_link: schedulingUrl,
              sender_name: actorName(user, company),
            }}
          />
        </Section>

        <Section
          title="Scheduling link"
          description="A Calendly, Cal.com or Google appointment link. Interview invites insert it as {{scheduling_link}}."
        >
          <SchedulingLinkForm initial={schedulingUrl} />
        </Section>

        <div id="notifications">
          <Section title="Notifications" description="Emails about new applicants and new matched candidates.">
            <NotificationSettings
              initial={{
                notifyNewApplicants: notify_new_applicants as "off" | "instant" | "daily",
                notifyWeeklyMatches: notify_weekly_matches,
              }}
            />
          </Section>
        </div>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
