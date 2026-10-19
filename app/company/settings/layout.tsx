import type { ReactNode } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import {
  Bell,
  CalendarClock,
  Globe,
  History,
  ListChecks,
  Mail,
  ShieldCheck,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react";
import Error from "@/components/Error";
import EntityLayout from "@/components/EntityLayout";
import type { EntityNavItem } from "@/components/EntityNav";
import PageHeader from "@/components/PageHeader";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny } from "@/helpers/companies/permissions";
import { QUESTION_SETS_PATH } from "@/helpers/jobs/question-sets";
import { createClient } from "@/lib/supabase/server";

const SETTINGS_PATH = "/company/settings";

/**
 * Settings' frame: the sections sidebar (pipeline stages, email templates,
 * scheduling link, notifications, careers page, question sets, team, hiring
 * teams, roles, audit log) and the Settings header. A main page, so the
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
      { href: SETTINGS_PATH, label: "Pipeline stages", icon: <Workflow />, exact: true },
      { href: `${SETTINGS_PATH}/email-templates`, label: "Email templates", icon: <Mail /> },
      { href: `${SETTINGS_PATH}/scheduling`, label: "Scheduling link", icon: <CalendarClock /> },
      { href: `${SETTINGS_PATH}/notifications`, label: "Notifications", icon: <Bell /> },
      { href: `${SETTINGS_PATH}/careers`, label: "Careers page", icon: <Globe /> },
    ];
    if (can(company, "jobs.view")) items.push({ href: QUESTION_SETS_PATH, label: "Question sets", icon: <ListChecks /> });
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
