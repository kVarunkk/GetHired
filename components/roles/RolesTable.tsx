"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable from "@/components/DataTable";
import RoleActions from "@/components/roles/RoleActions";
import RoleBadge from "@/components/roles/RoleBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CompanyRoleView } from "@/helpers/companies/list-roles";
import { grantSummary } from "@/helpers/companies/permissions";

/**
 * The Roles settings table (RP-REQ-014). Editing needs roles.manage and a
 * role within the viewer's ceiling (RP-REQ-012); the actions check again.
 */
export default function RolesTable({
  roles,
  canManage,
  myRoleId,
}: {
  roles: CompanyRoleView[];
  canManage: boolean;
  myRoleId: string | null;
}) {
  const manageable = roles.filter((r) => r.withinCeiling);

  const columns: ColumnDef<CompanyRoleView>[] = [
    {
      id: "role",
      header: "Role",
      cell: ({ row: { original: role } }) => (
        <div className="flex min-w-48 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/company/settings/roles/${role.id}`} className="hover:opacity-80">
              <RoleBadge role={role} />
            </Link>
            {role.isDefault && (
              <Badge variant="outline" className="text-muted-foreground" title="New invites get this role">
                Default
              </Badge>
            )}
            {myRoleId === role.id && <span className="text-xs text-muted-foreground">Your role</span>}
          </div>
          {role.description && (
            <p className="max-w-80 truncate text-xs text-muted-foreground" title={role.description}>
              {role.description}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "permissions",
      header: "Permissions",
      cell: ({ row }) => grantSummary(row.original.grants),
      meta: { className: "text-muted-foreground" },
    },
    {
      accessorKey: "memberCount",
      header: "Members",
      meta: { className: "tabular-nums text-muted-foreground" },
    },
    {
      accessorKey: "inviteCount",
      header: "Open invites",
      meta: { className: "tabular-nums text-muted-foreground" },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: role } }) => {
        const editable = canManage && role.withinCeiling;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/company/settings/roles/${role.id}`}>{editable ? "Edit" : "View"}</Link>
            </Button>
            {editable && (
              <RoleActions
                role={role}
                replacements={manageable.filter((r) => r.id !== role.id).map((r) => ({ id: r.id, name: r.name }))}
              />
            )}
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      aria-label="Roles"
      data={roles}
      columns={columns}
      noun="roles"
      emptyMessage="No roles yet."
      getRowId={(role) => role.id}
    />
  );
}
