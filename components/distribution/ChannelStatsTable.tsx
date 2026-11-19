"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable, { SortableHeader } from "@/components/DataTable";
import type { ChannelStats } from "@/helpers/distribution/channel-stats";

/** Applications and outcomes by channel for one job (MP-REQ-007). `names` maps a channel key to its label. */
export default function ChannelStatsTable({ stats, names }: { stats: ChannelStats[]; names: Record<string, string> }) {
  const columns: ColumnDef<ChannelStats>[] = useMemo(() => {
    const num = (id: keyof ChannelStats, label: string): ColumnDef<ChannelStats> => ({
      id,
      accessorFn: (row) => row[id],
      header: ({ column }) => <SortableHeader column={column} label={label} />,
    });
    return [
      {
        id: "channel",
        accessorFn: (row) => names[row.channel] ?? (row.channel === "gethired" ? "GetHired" : "Other"),
        header: ({ column }) => <SortableHeader column={column} label="Source" />,
      },
      num("applies", "Applications"),
      num("progressed", "In progress"),
      num("hired", "Hired"),
      num("rejected", "Rejected"),
    ];
  }, [names]);

  return (
    <DataTable
      data={stats}
      columns={columns}
      noun="sources"
      emptyMessage="No applications yet."
      getRowId={(row) => row.channel}
      pageSize={null}
      aria-label="Applications by source"
    />
  );
}
