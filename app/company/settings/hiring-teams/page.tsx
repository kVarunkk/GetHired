import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Error from "@/components/Error";
import Forbidden from "@/components/roles/Forbidden";
import HiringTeamsMatrix from "@/components/team/HiringTeamsMatrix";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { canAny } from "@/helpers/companies/permissions";
import { listCompanyHiringTeams } from "@/helpers/team/list-company-hiring-teams";
import { createClient } from "@/lib/supabase/server";

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
      <div className="mb-20 flex w-full flex-col gap-6 p-4">
        <Link
          href="/company/settings"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-brand"
        >
          <ArrowLeft className="h-4 w-4" /> Settings
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Hiring teams</h1>
          <p className="text-sm text-muted-foreground">
            Who&apos;s assigned to each job. Members whose role is limited to assigned jobs only see and work on the
            jobs they&apos;re ticked for. Owners and roles with access to all jobs see every job anyway.
          </p>
        </div>
        <HiringTeamsMatrix jobs={teams.jobs} members={teams.members} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
