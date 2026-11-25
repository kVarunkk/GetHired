import type { ReactNode } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import {
  Bell,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Globe,
  History,
  ListChecks,
  Mail,
  Share2,
  ShieldCheck,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react";
import Error from "@/components/Error";
import EntityLayout from "@/components/EntityLayout";
import type { EntityNavItem } from "@/components/EntityNav";
import PageHeader from "@/components/PageHeader";
import { DISTRIBUTION_SETTINGS_PATH } from "@/helpers/distribution/channel-status";
import { MY_CALENDAR_PATH } from "@/helpers/calendar/config";
import { calendarEnabled } from "@/helpers/calendar/connect";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny } from "@/helpers/companies/permissions";
import { JOB_SETTINGS_PATH } from "@/helpers/jobs/job-states";
import { QUESTION_SETS_PATH } from "@/helpers/jobs/question-sets";
import { PIPELINE_EDITOR_BASE } from "@/helpers/pipeline/config";
import { createClient } from "@/lib/supabase/server";

const SETTINGS_PATH = "/company/settings";

/**
 * Settings' frame: the sections sidebar (pipelines, email templates,
 * scheduling link, my calendar, notifications, careers page, distribution,
 * jobs, question sets,
 * team, hiring teams, roles, audit log) and the Settings header. A main page, so the
 * sidebar has no back link or title. Each section shows only with the
 * permission its page checks, and the page checks it again.
 */
export default async function CompanySettingsLayout({ children }: { children: ReactNode }) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company) notFound();

    // Everyone sees these, read-only without their permissions (RP-REQ-016).
    const items: EntityNavItem[] = [
      // The index lists the pipelines; each one's stage editor is under /pipelines (JPT-032/033).
      {
        href: SETTINGS_PATH,
        label: "Pipelines",
        icon: <Workflow />,
        exact: true,
        alsoActiveUnder: PIPELINE_EDITOR_BASE,
      },
      { href: `${SETTINGS_PATH}/email-templates`, label: "Email templates", icon: <Mail /> },
      { href: `${SETTINGS_PATH}/scheduling`, label: "Scheduling", icon: <CalendarClock /> },
      // Every member's own calendar (IVT-037), once Google Calendar is on.
      ...(calendarEnabled() ? [{ href: MY_CALENDAR_PATH, label: "My calendar", icon: <CalendarDays /> }] : []),
      { href: `${SETTINGS_PATH}/notifications`, label: "Notifications", icon: <Bell /> },
      { href: `${SETTINGS_PATH}/careers`, label: "Careers page", icon: <Globe /> },
    ];
    // Which job boards the company's jobs go to (MP-REQ-011); jobs can still opt out one by one.
    if (canAny(company, "distribution.view")) {
      items.push({ href: DISTRIBUTION_SETTINGS_PATH, label: "Distribution", icon: <Share2 /> });
    }
    if (can(company, "jobs.view")) {
      // JL-REQ-018: approval before a job opens (owners change it).
      items.push({ href: JOB_SETTINGS_PATH, label: "Jobs", icon: <Briefcase /> });
      items.push({ href: QUESTION_SETS_PATH, label: "Question sets", icon: <ListChecks /> });
    }
    if (can(company, "team.view")) items.push({ href: `${SETTINGS_PATH}/team`, label: "Team", icon: <Users /> });
    if (canAny(company, "jobs.assign")) {
      items.push({ href: `${SETTINGS_PATH}/hiring-teams`, label: "Hiring teams", icon: <UsersRound /> });
    }
    if (can(company, "roles.view")) items.push({ href: `${SETTINGS_PATH}/roles`, label: "Roles", icon: <ShieldCheck /> });
    if (can(company, "audit.view")) items.push({ href: `${SETTINGS_PATH}/audit`, label: "Audit log", icon: <History /> });

    return (
      <EntityLayout
        nav={{ label: "Settings sections", items }}
        header={
          <PageHeader title="Settings" description="Your team, careers page, hiring pipeline and notifications." />
        }
      >
        {children}
      </EntityLayout>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
