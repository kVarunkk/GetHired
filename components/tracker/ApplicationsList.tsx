"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import DataTable, { SortableHeader } from "@/components/DataTable";
import { isFollowUpDue, shortDate, sourceMark } from "@/helpers/tracker/card";
import { filterByKeyword } from "@/helpers/tracker/search";
import type { TrackerItem } from "@/helpers/tracker/types";
import { cn } from "@/utils/utils";
import { cardHref, LOCKED_TOOLTIP } from "./TrackerCard";
import KeywordSearch from "./KeywordSearch";

const columns: ColumnDef<TrackerItem>[] = [
  {
    accessorKey: "companyName",
    header: ({ column }) => <SortableHeader column={column} label="Company" />,
  },
  {
    accessorKey: "jobTitle",
    header: ({ column }) => <SortableHeader column={column} label="Title" />,
    cell: ({ row }) => (
      <Link href={cardHref(row.original)} className="font-medium hover:underline">
        {row.original.jobTitle}
      </Link>
    ),
  },
  {
    accessorKey: "statusLabel",
    header: ({ column }) => <SortableHeader column={column} label="Status" />,
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1">
        <Badge variant="outline" className="font-normal">
          {row.original.statusLabel}
        </Badge>
        {row.original.kind === "gethired" && <Lock className="h-3 w-3 text-muted-foreground" aria-label={LOCKED_TOOLTIP} />}
      </span>
    ),
  },
  {
    id: "source",
    accessorFn: (item) => sourceMark(item) ?? "",
    header: ({ column }) => <SortableHeader column={column} label="Source" />,
    cell: ({ getValue }) => <span className="text-muted-foreground">{(getValue() as string) || "–"}</span>,
  },
  {
    accessorKey: "appliedAt",
    header: ({ column }) => <SortableHeader column={column} label="Applied" />,
    cell: ({ row }) => shortDate(row.original.appliedAt),
  },
  {
    accessorKey: "nextFollowUpAt",
    header: ({ column }) => <SortableHeader column={column} label="Follow-up" />,
    sortUndefined: "last",
    cell: ({ row }) =>
      row.original.nextFollowUpAt ? (
        <span className={cn(isFollowUpDue(row.original.nextFollowUpAt) && "font-medium text-destructive")}>
          {shortDate(row.original.nextFollowUpAt)}
        </span>
      ) : (
        <span className="text-muted-foreground">–</span>
      ),
  },
  {
    accessorKey: "updatedAt",
    header: ({ column }) => <SortableHeader column={column} label="Updated" />,
    cell: ({ row }) => shortDate(row.original.updatedAt),
  },
];

/** The Applications tab's List view (AT-REQ-019): every card, paged client-side. */
export default function ApplicationsList({ items, q }: { items: TrackerItem[]; q?: string | null }) {
  const router = useRouter();
  const rows = filterByKeyword(items, q);

  return (
    <DataTable
      aria-label="Applications"
      data={rows}
      columns={columns}
      noun="applications"
      getRowId={(item) => `${item.kind}:${item.id}`}
      initialSorting={[{ id: "appliedAt", desc: true }]}
      filters={() => <KeywordSearch />}
      externalFiltersActive={Boolean(q?.trim())}
      onClearFilters={() => router.replace("?view=list", { scroll: false })}
      emptyMessage={q?.trim() ? "No applications match your search." : "No applications yet."}
    />
  );
}
