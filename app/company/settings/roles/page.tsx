import Link from "next/link";
import { notFound, unstable_rethrow } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Error from "@/components/Error";
import Forbidden from "@/components/roles/Forbidden";
import NewRoleMenu from "@/components/roles/NewRoleMenu";
import RoleActions from "@/components/roles/RoleActions";
import RoleBadge from "@/components/roles/RoleBadge";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { listRoles } from "@/helpers/companies/list-roles";
import { can, grantSummary } from "@/helpers/companies/permissions";
import { createClient } from "@/lib/supabase/server";

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
      <div className="mb-20 flex w-full flex-col gap-6 p-4">
        <Link
          href="/company/settings"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-brand"
        >
          <ArrowLeft className="h-4 w-4" /> Settings
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Roles</h1>
            <p className="text-sm text-muted-foreground">
              What each role on your team can do. Owners can always do everything.
              {!canManage && " You can view roles but not change them."}
            </p>
          </div>
          {canManage && <NewRoleMenu roles={manageable.map((r) => ({ id: r.id, name: r.name }))} />}
        </div>

        <ul className="divide-y rounded-lg border" aria-label="Roles">
          {roles.map((role) => {
            const editable = canManage && role.withinCeiling;
            return (
              <li key={role.id} className="flex items-start justify-between gap-3 p-4">
                <Link href={`/company/settings/roles/${role.id}`} className="group min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <RoleBadge role={role} />
                    {role.isDefault && (
                      <Badge variant="outline" className="text-muted-foreground" title="New invites get this role">
                        Default
                      </Badge>
                    )}
                    {company.role?.id === role.id && (
                      <span className="text-xs text-muted-foreground">Your role</span>
                    )}
                  </div>
                  {role.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {grantSummary(role.grants)} · {role.memberCount} member{role.memberCount === 1 ? "" : "s"}
                    {role.inviteCount > 0 &&
                      ` · ${role.inviteCount} open invite${role.inviteCount === 1 ? "" : "s"}`}
                    <span className="ml-2 underline-offset-4 group-hover:text-brand group-hover:underline">
                      {editable ? "Edit" : "View"}
                    </span>
                  </p>
                </Link>
                {editable && (
                  <RoleActions
                    role={role}
                    replacements={manageable.filter((r) => r.id !== role.id).map((r) => ({ id: r.id, name: r.name }))}
                  />
                )}
              </li>
            );
          })}
          {roles.length === 0 && <li className="p-4 text-sm text-muted-foreground">No roles yet.</li>}
        </ul>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
