"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import type { ColumnDef } from "@tanstack/react-table";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/responsive-select";
import DataTable, { SortableHeader } from "@/components/DataTable";
import { setTrackedStatusAction } from "@/app/actions/tracker/set-tracked-status";
import { setExternalApplicationStatusAction } from "@/app/actions/applications/set-external-application-status";
import { isFollowUpDue, shortDate, sourceMark } from "@/helpers/tracker/card";
import { filterByKeyword } from "@/helpers/tracker/search";
import { APPLIED_STATUSES, trackedStatusLabel, type AppliedStatus } from "@/helpers/tracker/status";
import type { TrackerItem } from "@/helpers/tracker/types";
import { cn } from "@/utils/utils";
import { cardHref, JOB_CLOSED_LABEL, JOB_CLOSED_TOOLTIP, LOCKED_TOOLTIP } from "./TrackerCard";
import KeywordSearch from "./KeywordSearch";

async function saveStatus(item: TrackerItem, status: AppliedStatus) {
  if (item.legacy) {
    if (!item.allJobsId) return { ok: false as const, error: "Application not found." };
    return setExternalApplicationStatusAction({ allJobsId: item.allJobsId, status });
  }
  return setTrackedStatusAction({ id: item.id, status });
}

/** A tracked row's status, changeable in place. GetHired rows are the company's to move. */
function StatusCell({ item, onChange }: { item: TrackerItem; onChange: (status: AppliedStatus) => void }) {
  if (item.kind === "gethired" || !item.status) {
    return (
      <span className="inline-flex items-center gap-1">
        <Badge variant="outline" className="font-normal">
          {item.statusLabel}
        </Badge>
        {item.kind === "gethired" && <Lock className="h-3 w-3 text-muted-foreground" aria-label={LOCKED_TOOLTIP} />}
      </span>
    );
  }
  return (
    <Select title={`Status of ${item.jobTitle}`} value={item.status} onValueChange={(value) => onChange(value as AppliedStatus)}>
      <SelectTrigger aria-label={`Status of ${item.jobTitle}`} className="h-8 w-36 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {APPLIED_STATUSES.map((status) => (
          <SelectItem key={status} value={status} className="text-xs">
            {trackedStatusLabel(status)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const buildColumns = (onStatusChange: (item: TrackerItem, status: AppliedStatus) => void): ColumnDef<TrackerItem>[] => [
  {
    accessorKey: "companyName",
    header: ({ column }) => <SortableHeader column={column} label="Company" />,
  },
  {
    accessorKey: "jobTitle",
    header: ({ column }) => <SortableHeader column={column} label="Title" />,
    cell: ({ row }) => (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Link href={cardHref(row.original)} className="font-medium hover:underline">
          {row.original.jobTitle}
        </Link>
        {row.original.jobClosed && (
          <Badge variant="outline" className="font-normal text-muted-foreground" title={JOB_CLOSED_TOOLTIP}>
            {JOB_CLOSED_LABEL}
          </Badge>
        )}
      </span>
    ),
  },
  {
    accessorKey: "statusLabel",
    header: ({ column }) => <SortableHeader column={column} label="Status" />,
    cell: ({ row }) => <StatusCell item={row.original} onChange={(status) => onStatusChange(row.original, status)} />,
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
  // Status picks shown before the server confirms them; a failed save drops its pick.
  const [picked, setPicked] = useState<Record<string, AppliedStatus>>({});

  useEffect(() => {
    setPicked({});
  }, [items]);

  const onStatusChange = useCallback(
    async (item: TrackerItem, status: AppliedStatus) => {
      if (status === item.status) return;
      setPicked((current) => ({ ...current, [item.id]: status }));
      const result = await saveStatus(item, status);
      if (!result.ok) {
        setPicked((current) => {
          const next = { ...current };
          delete next[item.id];
          return next;
        });
        toast.error(result.error);
        return;
      }
      router.refresh();
    },
    [router],
  );

  const columns = useMemo(() => buildColumns(onStatusChange), [onStatusChange]);
  const rows = useMemo(
    () =>
      filterByKeyword(items, q).map((item) => {
        const status = picked[item.id];
        return status ? { ...item, status, statusLabel: trackedStatusLabel(status) } : item;
      }),
    [items, q, picked],
  );

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
