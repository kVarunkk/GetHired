"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import toast from "react-hot-toast";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable, { SortableHeader } from "@/components/DataTable";
import { setChannelEnabledAction } from "@/app/actions/distribution/channel-actions";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { KIND_LABELS, type ChannelKind } from "@/helpers/distribution/channel-status";
import type { CompanyChannel, CompanyChannelState } from "@/helpers/distribution/load-job-distribution";

const STATE: Record<CompanyChannelState, { label: string; variant: "success" | "outline" | "secondary" | "destructive" }> = {
  always_on: { label: "Always on", variant: "success" },
  on: { label: "On", variant: "success" },
  waiting_for_approval: { label: "On, waiting for the board", variant: "secondary" },
  off: { label: "Off", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
};

/**
 * Settings → Distribution (MP-REQ-011): one switch per channel for all the
 * company's jobs. Each job's Distribution section can then leave itself out
 * of an active channel. Needs `distribution.manage` with scope `all`; the
 * action checks again.
 */
export default function CompanyChannelsTable({
  channels,
  canManage = false,
}: {
  channels: CompanyChannel[];
  canManage?: boolean;
}) {
  const columns: ColumnDef<CompanyChannel>[] = useMemo(
    () => [
      {
        id: "channel",
        accessorFn: (row) => row.name,
        header: ({ column }) => <SortableHeader column={column} label="Channel" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="font-medium [overflow-wrap:anywhere]">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">
              {KIND_LABELS[row.original.kind as ChannelKind] ?? row.original.kind}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.state,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={STATE[row.original.state].variant} className="whitespace-nowrap font-normal">
            {STATE[row.original.state].label}
          </Badge>
        ),
      },
      {
        id: "active",
        header: "Active",
        meta: { className: "text-right", headerClassName: "text-right" },
        cell: ({ row }) => <ChannelSwitch channel={row.original} canManage={canManage} />,
      },
    ],
    [canManage],
  );

  return (
    <DataTable
      data={channels}
      columns={columns}
      noun="channels"
      emptyMessage="No channels are available yet."
      getRowId={(row) => row.key}
      pageSize={null}
      aria-label="Distribution channels"
    />
  );
}

function ChannelSwitch({ channel, canManage }: { channel: CompanyChannel; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  // Held until the action's transition (including the revalidated page)
  // commits, so the switch never shows the old state in between.
  const [checked, setChecked] = useOptimistic(channel.state !== "off");

  if (channel.state === "always_on") {
    return <span className="text-sm text-muted-foreground">Always on</span>;
  }
  if (!channel.canToggle) return <span className="text-muted-foreground">—</span>;

  return (
    <Switch
      aria-label={`${channel.name} active`}
      checked={checked}
      disabled={!canManage || pending}
      onCheckedChange={(enabled) => {
        startTransition(async () => {
          setChecked(enabled);
          const result = await setChannelEnabledAction({ channelKey: channel.key, enabled });
          // The action revalidates the page, so its response carries the
          // saved state; no router.refresh() round trip.
          if (!result.ok) toast.error(result.error);
        });
      }}
    />
  );
}
