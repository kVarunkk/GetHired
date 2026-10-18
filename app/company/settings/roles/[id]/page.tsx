import { notFound, unstable_rethrow } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import AskAgentAboutRoles from "@/components/agent/recruiter/AskAgentAboutRoles";
import Error from "@/components/Error";
import PageHeader from "@/components/PageHeader";
import Forbidden from "@/components/roles/Forbidden";
import RoleActions from "@/components/roles/RoleActions";
import RoleEditor from "@/components/roles/RoleEditor";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { listRoles } from "@/helpers/companies/list-roles";
import { can, grantList } from "@/helpers/companies/permissions";
import { ROLE_COLORS, type RoleColor } from "@/helpers/companies/role-templates";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const asColor = (c: string): RoleColor => (ROLE_COLORS as readonly string[]).includes(c) ? (c as RoleColor) : "slate";

/**
 * Settings → Roles → one role (RP-REQ-014). Needs roles.view. Read-only
 * without roles.manage or for a role above the viewer's ceiling; on their
 * own role only the name and description can change (RP-REQ-012 rule 5).
 */
export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) notFound();
    const company = await getMyCompany(supabase, user);
    if (!company) notFound();
    if (!can(company, "roles.view")) return <Forbidden what="roles" />;

    const roles = (await listRoles(supabase, company)) ?? [];
    const role = roles.find((r) => r.id === id);
    if (!role) notFound();

    const canManage = can(company, "roles.manage");
    const readOnly = !canManage || !role.withinCeiling;
    const ownRole = company.role?.id === role.id;

    return (
      <div className="mb-20 flex w-full max-w-4xl flex-col gap-6 p-4">
        <PageHeader
          backHref="/company/settings/roles"
          backLabel="Back to roles"
          title={role.name}
          description={
            readOnly &&
            (canManage
              ? "This role has permissions you don't have, so you can't change it."
              : "You can view this role but not change it.")
          }
          actions={
            (role.isDefault || !readOnly) && (
              <>
                {role.isDefault && (
                  <Badge variant="outline" className="text-muted-foreground" title="New invites get this role">
                    Default
                  </Badge>
                )}
                {!readOnly && (
                  <RoleActions
                    role={role}
                    redirectOnDelete
                    replacements={roles
                      .filter((r) => r.id !== role.id && r.withinCeiling)
                      .map((r) => ({ id: r.id, name: r.name }))}
                  />
                )}
              </>
            )
          }
        />

        {can(company, "agent.use") && (
          <AskAgentAboutRoles role={{ id: role.id, name: role.name }} canManage={!readOnly && !ownRole} />
        )}

        <section className="flex flex-col gap-2 rounded-lg border p-5" aria-label="Who has this role">
          <h2 className="text-lg font-semibold tracking-tight">Who has this role</h2>
          {role.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 text-sm">
              {role.members.map((m) => (
                <li key={m.userId} className="rounded-md border px-2 py-1">
                  {m.name ?? "Unnamed member"}
                  {m.userId === user.id && <span className="text-muted-foreground"> (you)</span>}
                </li>
              ))}
            </ul>
          )}
          {role.inviteCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Plus {role.inviteCount} open invite{role.inviteCount === 1 ? "" : "s"}.
            </p>
          )}
        </section>

        <RoleEditor
          mode="edit"
          roleId={role.id}
          initial={{
            name: role.name,
            description: role.description ?? "",
            color: asColor(role.color),
            grants: role.grants,
            limits: role.limits,
            templateKey: role.templateKey,
          }}
          viewer={{ isOwner: company.isOwner, grants: grantList(company.grants), limits: company.limits }}
          readOnly={readOnly}
          ownRole={ownRole}
        />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
