"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable, { SortableHeader } from "@/components/DataTable";
import { setJobChannelOptOutAction } from "@/app/actions/distribution/channel-actions";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DISTRIBUTION_SETTINGS_PATH,
  KIND_LABELS,
  STATE_LABELS,
  type ChannelRow,
  type ChannelState,
} from "@/helpers/distribution/channel-status";

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
}: {
  rows: ChannelRow[];
  jobId?: string;
  /** distribution.manage on this job: switch each active channel on or off for it. */
  canManage?: boolean;
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
      ...(jobId
        ? [
            {
              id: "post",
              header: "Post this job",
              meta: { className: "text-right", headerClassName: "text-right" },
              cell: ({ row }) => <PostToChannel row={row.original} jobId={jobId} canManage={canManage} />,
            } satisfies ColumnDef<ChannelRow>,
          ]
        : []),
    ],
    [jobId, canManage],
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

/** The kinds a job can opt out of; the rest are always on or set up elsewhere. */
const OPTABLE_KINDS = new Set(["feed", "partner_api"]);

/**
 * MP-REQ-011: whether this job goes on the channel. Turning a channel on or
 * off for every job lives in Settings → Distribution.
 */
function PostToChannel({ row, jobId, canManage }: { row: ChannelRow; jobId?: string; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  // Held until the action's transition (including the revalidated page)
  // commits, so the switch never shows the old state in between.
  const [posted, setPosted] = useOptimistic(row.state !== "opted_out");

  if (row.kind === "index") return <span className="text-sm text-muted-foreground">Always</span>;
  if (!OPTABLE_KINDS.has(row.kind)) return <span className="text-muted-foreground">—</span>;
  if (row.state === "off") {
    return (
      <Link href={DISTRIBUTION_SETTINGS_PATH} className="text-sm text-muted-foreground underline underline-offset-4">
        Off in Settings
      </Link>
    );
  }

  return (
    <Switch
      aria-label={`Post this job on ${row.name}`}
      checked={posted}
      disabled={!canManage || !jobId || pending}
      onCheckedChange={(next) => {
        if (!jobId) return;
        startTransition(async () => {
          setPosted(next);
          const result = await setJobChannelOptOutAction({ jobId, channelKey: row.key, optedOut: !next });
          // The action revalidates the page, so its response carries the
          // saved state; no router.refresh() round trip.
          if (!result.ok) toast.error(result.error);
        });
      }}
    />
  );
}
