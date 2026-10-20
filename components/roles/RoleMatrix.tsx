import { Check, Minus } from "lucide-react";
import {
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  type PermissionKey,
  type PermissionScope,
} from "@/helpers/companies/permissions";
import RoleBadge from "./RoleBadge";

export type RoleMatrixRole = {
  id: string;
  name: string;
  color: string;
  grants: { key: PermissionKey; scope: PermissionScope }[];
};

/**
 * RP-REQ-013: what each of the company's roles allows, generated from the
 * catalog and the roles (replaces the fixed owner/admin/member table). Owners
 * have everything (RP-DEC-001).
 */
export default function RoleMatrix({
  roles,
  myRoleId,
  isOwner,
}: {
  roles: RoleMatrixRole[];
  myRoleId: string | null;
  isOwner: boolean;
}) {
  const scopes = roles.map((r) => new Map(r.grants.map((g) => [g.key, g.scope])));

  return (
    <section id="role-permissions" className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">What each role can do</h2>
        <p className="text-sm text-muted-foreground">
          {isOwner
            ? "You're an owner: you can do everything, including billing and managing owners."
            : `Your role is highlighted. Owners can do everything, including billing and managing owners.`}
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm" aria-label="Role permissions">
          <thead>
            <tr className="border-b">
              <th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">
                Permission
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                <RoleBadge owner />
              </th>
              {roles.map((role) => (
                <th
                  key={role.id}
                  scope="col"
                  className={`px-3 py-2 text-left font-medium ${role.id === myRoleId ? "bg-brandSoft" : ""}`}
                >
                  <RoleBadge role={role} />
                </th>
              ))}
            </tr>
          </thead>
          {PERMISSION_GROUPS.map((group) => (
            <tbody key={group}>
              <tr className="border-b bg-muted/30">
                <th
                  scope="rowgroup"
                  colSpan={roles.length + 2}
                  className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground"
                >
                  {group}
                </th>
              </tr>
              {PERMISSION_CATALOG.filter((p) => p.group === group).map((p) => (
                <tr key={p.key} className="border-b last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {p.label}
                  </th>
                  <td className="px-3 py-2">
                    <Check className="h-4 w-4" aria-label="Yes" />
                  </td>
                  {roles.map((role, i) => {
                    const scope = scopes[i].get(p.key);
                    return (
                      <td key={role.id} className={`px-3 py-2 ${role.id === myRoleId ? "bg-brandSoft" : ""}`}>
                        {scope === "all" ? (
                          <Check className="h-4 w-4" aria-label="Yes" />
                        ) : scope === "assigned" ? (
                          <span className="text-xs text-muted-foreground">Assigned jobs</span>
                        ) : (
                          <Minus className="h-4 w-4 text-muted-foreground" aria-label="No" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
