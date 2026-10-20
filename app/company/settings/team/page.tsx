import { notFound, unstable_rethrow } from "next/navigation";
import { AskAgentAboutTeam } from "@/components/agent/recruiter/AskAgentAboutTeam";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import InviteDialog from "@/components/team/InviteDialog";
import RoleMatrix from "@/components/roles/RoleMatrix";
import TeamTable from "@/components/team/TeamTable";
import Forbidden from "@/components/roles/Forbidden";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny } from "@/helpers/companies/permissions";
import { listRoles } from "@/helpers/companies/list-roles";
import { inviteRoleOptions } from "@/helpers/team/invite-roles";
import { listTeam } from "@/helpers/team/list-team";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Settings → Team (TM-REQ-006, RP-REQ-013). Needs team.view; each control
 * follows the viewer's permissions, computed here (RP-REQ-016). The actions
 * and RPCs check again.
 */
export default async function CompanyTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();
    if (!can(company, "team.view")) return <Forbidden what="the team" />;

    const [team, roles] = await Promise.all([
      listTeam(supabase, company),
      can(company, "roles.view") ? listRoles(supabase, company) : Promise.resolve(null),
    ]);
    const primary = team.members.find((m) => m.isPrimaryOwner);
    const canInvite = can(company, "team.invite");
    // Back from making a role for an invite (NEW_ROLE_FOR_INVITE_HREF).
    const { invite: inviteRoleId } = await searchParams;

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Team"
          description={<>Who&apos;s on {company.name ?? "your company"}&apos;s hiring team and what their roles allow.</>}
          actions={
            canInvite && (
              <InviteDialog
                ownerEmail={primary?.email ?? null}
                seats={team.seats}
                roles={inviteRoleOptions(company, roles)}
                canCreateRole={can(company, "roles.manage")}
                initialRoleId={inviteRoleId}
                canUseAgent={can(company, "agent.use")}
              />
            )
          }
        />
        {can(company, "agent.use") && (
          <AskAgentAboutTeam
            canInvite={canInvite}
            canAssignRoles={can(company, "team.assign_roles") && can(company, "roles.view")}
            canAssignJobs={canAny(company, "jobs.assign")}
          />
        )}
        <TeamTable
          members={team.members}
          invites={team.invites}
          roles={(roles ?? []).map((r) => ({ id: r.id, name: r.name, color: r.color, withinCeiling: r.withinCeiling }))}
          me={{
            userId: user.id,
            isOwner: company.isOwner,
            isPrimaryOwner: company.isPrimaryOwner,
            canAssignRoles: can(company, "team.assign_roles"),
            canRemove: can(company, "team.remove"),
            canInvite,
          }}
          companyName={company.name ?? ""}
        />
        {roles && (
          <RoleMatrix
            roles={roles.map((r) => ({ id: r.id, name: r.name, color: r.color, grants: r.grants }))}
            myRoleId={company.role?.id ?? null}
            isOwner={company.isOwner}
          />
        )}
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
