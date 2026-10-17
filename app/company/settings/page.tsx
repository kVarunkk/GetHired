import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { History, ShieldCheck, Users, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import Error from "@/components/Error";
import StageEditor from "@/components/pipeline/StageEditor";
import TemplateEditor from "@/components/pipeline/TemplateEditor";
import SchedulingLinkForm from "@/components/pipeline/SchedulingLinkForm";
import NotificationSettings from "@/components/pipeline/NotificationSettings";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny, forbiddenMessage, type PermissionKey } from "@/helpers/companies/permissions";
import { actorName } from "@/helpers/pipeline/move";
import { listStages } from "@/helpers/pipeline/stages";
import { createClient } from "@/lib/supabase/server";

function Section({
  title,
  description,
  children,
  readOnly,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  /** RP-REQ-016: the catalog message when the viewer's role can't change it. */
  readOnly?: string | null;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border p-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {readOnly && (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">{readOnly}</p>
      )}
      {/* A disabled fieldset disables every control inside. */}
      <fieldset disabled={Boolean(readOnly)} title={readOnly ?? undefined} className="disabled:opacity-80">
        {children}
      </fieldset>
    </section>
  );
}

/**
 * Company settings (PL-TASK-032, PL-TASK-040): pipeline stages, email
 * templates, the scheduling link and notifications, plus links to the team,
 * roles and the audit log. Each section is read-only without its permission
 * (RP-REQ-016); the actions check again.
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
        .select("id, purpose, name, subject, body_md, is_default")
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
    const {
      scheduling_url: schedulingUrl,
      notify_new_applicants,
      notify_weekly_matches,
    } = settingsResult.data;
    const readOnly = (key: PermissionKey) => (can(company, key) ? null : forbiddenMessage(key));

    return (
      <div className="mb-20 flex w-full flex-col gap-6 p-4">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
          Settings
        </h1>

        {(can(company, "team.view") ||
          can(company, "roles.view") ||
          can(company, "audit.view") ||
          canAny(company, "jobs.assign")) && (
          <section className="flex flex-col gap-4 rounded-lg border p-5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Team and roles</h2>
              <p className="text-sm text-muted-foreground">
                Who&apos;s on your hiring team, who works on which job, what each role allows and who changed what.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {can(company, "team.view") && (
                <Button asChild variant="outline" className="w-fit">
                  <Link href="/company/settings/team">
                    <Users className="mr-2 h-4 w-4" />
                    Team
                  </Link>
                </Button>
              )}
              {canAny(company, "jobs.assign") && (
                <Button asChild variant="outline" className="w-fit">
                  <Link href="/company/settings/hiring-teams">
                    <UsersRound className="mr-2 h-4 w-4" />
                    Hiring teams
                  </Link>
                </Button>
              )}
              {can(company, "roles.view") && (
                <Button asChild variant="outline" className="w-fit">
                  <Link href="/company/settings/roles">
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Roles
                  </Link>
                </Button>
              )}
              {can(company, "audit.view") && (
                <Button asChild variant="outline" className="w-fit">
                  <Link href="/company/settings/audit">
                    <History className="mr-2 h-4 w-4" />
                    Audit log
                  </Link>
                </Button>
              )}
            </div>
          </section>
        )}


          <Section
            title="Pipeline stages"
            readOnly={readOnly("settings.stages")}
            description="The columns of every job's board. Each stage shows candidates one of their statuses."
          >
            <StageEditor
              stages={stages.map(({ id, name, kind }) => ({ id, name, kind }))}
            />
          </Section>

          <Section
            title="Email templates"
            readOnly={readOnly("settings.templates")}
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
            readOnly={readOnly("settings.scheduling")}
            description="A Calendly, Cal.com or Google appointment link. Interview invites insert it as {{scheduling_link}}."
          >
            <SchedulingLinkForm initial={schedulingUrl} />
          </Section>

          <div id="notifications">
            <Section
              title="Notifications"
              readOnly={readOnly("settings.notifications")}
              description="Emails about new applicants and new matched candidates."
            >
              <NotificationSettings
                initial={{
                  notifyNewApplicants: notify_new_applicants as
                    "off" | "instant" | "daily",
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
