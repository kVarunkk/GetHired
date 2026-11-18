"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable, { SortableHeader } from "@/components/DataTable";
import { setChannelEnabledAction, setJobChannelOptOutAction } from "@/app/actions/distribution/channel-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KIND_LABELS, STATE_LABELS, type ChannelRow, type ChannelState } from "@/helpers/distribution/channel-status";

const VARIANT: Record<ChannelState, "success" | "outline" | "secondary" | "destructive"> = {
  live: "success",
  queued: "secondary",
  not_live: "outline",
  off: "outline",
  pending_approval: "outline",
  opted_out: "outline",
  error: "destructive",
};

/** Every channel and its status for one job, with the reason when it isn't live (MP-REQ-001). */
export default function DistributionTable({
  rows,
  jobId,
  canManage = false,
  canManageAll = false,
}: {
  rows: ChannelRow[];
  jobId?: string;
  /** distribution.manage on this job: leave the job out of a channel. */
  canManage?: boolean;
  /** distribution.manage for the whole company: turn a channel on or off. */
  canManageAll?: boolean;
}) {
  const columns: ColumnDef<ChannelRow>[] = useMemo(
    () => [
      {
        id: "channel",
        accessorFn: (row) => row.name,
        header: ({ column }) => <SortableHeader column={column} label="Channel" />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span className="font-medium [overflow-wrap:anywhere]">{row.original.name}</span>
            <span className="text-xs text-muted-foreground">{KIND_LABELS[row.original.kind]}</span>
          </div>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.state,
        header: "Status",
        cell: ({ row }) => (
          <Badge variant={VARIANT[row.original.state]} className="whitespace-nowrap font-normal">
            {STATE_LABELS[row.original.state]}
          </Badge>
        ),
      },
      {
        id: "reasons",
        accessorFn: (row) => row.reasons.join(", "),
        header: "Details",
        cell: ({ row }) =>
          row.original.reasons.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
              {row.original.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ),
      },
      ...(canManage || canManageAll
        ? [
            {
              id: "actions",
              header: "",
              cell: ({ row }) => (
                <ChannelActions row={row.original} jobId={jobId} canManage={canManage} canManageAll={canManageAll} />
              ),
            } satisfies ColumnDef<ChannelRow>,
          ]
        : []),
    ],
    [jobId, canManage, canManageAll],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      noun="channels"
      emptyMessage="No channels are available yet."
      getRowId={(row) => row.key}
      pageSize={null}
      aria-label="Distribution channels"
    />
  );
}

/** Opt-in for the company and opt-out for the job, feed channels only (MP-REQ-011). */
function ChannelActions({
  row,
  jobId,
  canManage,
  canManageAll,
}: {
  row: ChannelRow;
  jobId?: string;
  canManage: boolean;
  canManageAll: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (row.kind !== "feed") return null;

  const enabled = row.state !== "off";
  const run = (action: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) toast.error(result.error);
      else router.refresh();
    });

  return (
    <div className="flex justify-end gap-2">
      {enabled && canManage && jobId && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(() => setJobChannelOptOutAction({ jobId, channelKey: row.key, optedOut: row.state !== "opted_out" }))
          }
        >
          {row.state === "opted_out" ? "Include this job" : "Leave this job out"}
        </Button>
      )}
      {canManageAll && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => setChannelEnabledAction({ channelKey: row.key, enabled: !enabled }))}
        >
          {enabled ? "Turn off" : "Turn on"}
        </Button>
      )}
    </div>
  );
}
