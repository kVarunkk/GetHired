import { notFound, unstable_rethrow } from "next/navigation";
import { AskAgentAboutHiringTeams } from "@/components/agent/recruiter/AskAgentAboutTeam";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import Forbidden from "@/components/roles/Forbidden";
import HiringTeamsMatrix from "@/components/team/HiringTeamsMatrix";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny } from "@/helpers/companies/permissions";
import { listCompanyHiringTeams } from "@/helpers/team/list-company-hiring-teams";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hiring Teams",
};

export const dynamic = "force-dynamic";

/**
 * Settings → Hiring teams (RP-REQ-011): who is assigned to which job, for
 * every job the viewer has jobs.assign on, in one place. The job page's
 * Hiring team panel does the same for one job. The actions and RPCs check
 * again.
 */
export default async function CompanyHiringTeamsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();
    if (!canAny(company, "jobs.assign")) return <Forbidden what="hiring teams" />;

    const teams = await listCompanyHiringTeams(supabase);
    if (!teams) return <Forbidden what="hiring teams" />;

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Hiring teams"
          description={
            <>
              Who&apos;s assigned to each job. Members whose role is limited to assigned jobs only see and work on the
              jobs they&apos;re ticked for. Owners and roles with access to all jobs see every job anyway.
            </>
          }
        />
        {can(company, "agent.use") && <AskAgentAboutHiringTeams />}
        <HiringTeamsMatrix jobs={teams.jobs} members={teams.members} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
