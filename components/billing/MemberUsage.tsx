"use client";

import type { ColumnDef } from "@tanstack/react-table";
import DataTable from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import { ALLOWANCE_KEYS, KEY_LABELS } from "@/helpers/billing/keys";
import type { MemberUsageRow } from "@/helpers/billing/member-usage";

/** RP-REQ-044: what each member spent this period, against their role's caps. */
export default function MemberUsage({ rows }: { rows: MemberUsageRow[] }) {
  // One column per key that anyone has used or is capped on.
  const keys = ALLOWANCE_KEYS.filter((k) =>
    rows.some((row) => (row.usage[k] ?? 0) > 0 || row.limits[k] !== undefined),
  );
  const usageColumns: ColumnDef<MemberUsageRow>[] =
    keys.length === 0
      ? [
          {
            id: "usage",
            header: "Usage",
            cell: () => "No usage yet",
            meta: { className: "text-muted-foreground" },
          },
        ]
      : keys.map((key) => ({
          id: key,
          header: KEY_LABELS[key].many,
          cell: ({ row }) => {
            const used = row.original.usage[key] ?? 0;
            const limit = row.original.limits[key];
            const atCap = limit !== undefined && used >= limit;
            return (
              <span
                data-testid={`member-usage-${row.original.userId}-${key}`}
                className={atCap ? "tabular-nums text-destructive" : "tabular-nums"}
              >
                {limit === undefined
                  ? used.toLocaleString("en-US")
                  : `${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")}`}
              </span>
            );
          },
          meta: { headerClassName: "capitalize" },
        }));
  const columns: ColumnDef<MemberUsageRow>[] = [
    {
      id: "member",
      header: "Member",
      cell: ({ row }) => row.original.name,
      meta: { className: "font-medium" },
    },
    {
      id: "role",
      header: "Role",
      cell: ({ row }) => (
        <Badge variant="secondary">{row.original.isOwner ? "Owner" : (row.original.roleName ?? "No role")}</Badge>
      ),
    },
    ...usageColumns,
  ];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-semibold tracking-tight">Usage by member</h3>
        <p className="text-sm text-muted-foreground">
          This month&apos;s usage per person. Caps come from each member&apos;s role.
        </p>
      </div>
      <DataTable
        aria-label="Usage by member"
        data={rows}
        columns={columns}
        noun="members"
        getRowId={(row) => row.userId}
      />
    </section>
  );
}
