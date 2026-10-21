import { notFound, unstable_rethrow } from "next/navigation";
import AskAgentAboutRoles from "@/components/agent/recruiter/AskAgentAboutRoles";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import Forbidden from "@/components/roles/Forbidden";
import NewRoleMenu from "@/components/roles/NewRoleMenu";
import RolesTable from "@/components/roles/RolesTable";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { listRoles } from "@/helpers/companies/list-roles";
import { can } from "@/helpers/companies/permissions";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Roles",
};

export const dynamic = "force-dynamic";

/**
 * Settings → Roles (RP-REQ-014). Needs roles.view; with roles.manage the
 * viewer can add, edit, delete and pick the default, but only for roles
 * within their own ceiling (RP-REQ-012). The actions and RPCs check again.
 */
export default async function CompanyRolesPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();
    if (!can(company, "roles.view")) return <Forbidden what="roles" />;

    const roles = (await listRoles(supabase, company)) ?? [];
    const canManage = can(company, "roles.manage");
    const manageable = roles.filter((r) => r.withinCeiling);

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Roles"
          description={
            <>
              What each role on your team can do. Owners can always do everything.
              {!canManage && " You can view roles but not change them."}
            </>
          }
          actions={canManage && <NewRoleMenu roles={manageable.map((r) => ({ id: r.id, name: r.name }))} />}
        />

        {can(company, "agent.use") && (
          <AskAgentAboutRoles canManage={canManage} canAssignRoles={can(company, "team.assign_roles")} />
        )}

        <RolesTable roles={roles} canManage={canManage} myRoleId={company.role?.id ?? null} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
