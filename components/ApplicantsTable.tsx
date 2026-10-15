"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  RowSelectionState,
  SortingState,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { format } from "date-fns";
import { ChevronRight, ArrowUpDown, Loader2, XCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { StageOption } from "@/components/pipeline/StagePicker";
import ApplicationStatusBadge from "./ApplicationStatusBadge";
import MatchScoreBadge from "./matching/MatchScoreBadge";
import { TApplicationServer } from "@/utils/types/application.types";
import { TApplicationStatus } from "@/utils/types";
import { RECOMMENDATION_LABELS, type ScreeningRecommendation } from "@/helpers/matching/config";
import { isScreeningInProgress, type ScreeningStatus } from "@/helpers/matching/screening-view";
import { useEntitlementError } from "@/hooks/useEntitlementError";

interface ApplicantsTableProps {
  data: (TApplicationServer & { stage_id?: string | null })[];
  /** In one job's context: enables "Screen N unscreened". */
  jobPostId?: string;
  /** "fit" sorts by fit score, highest first. */
  defaultSort?: "fit";
  /**
   * The pipeline list (PL-TASK-004): the company's active stages. Adds a
   * selection checkbox per row, a Stage column and a stage filter.
   */
  stages?: StageOption[];
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
}

type Row = TApplicationServer & {
  stage_id?: string | null;
  applicantName: string;
  jobTitle: string;
};

const ALL_STAGES = "All stages";

const applicationStatuses = [
  "All Statuses",
  "submitted",
  "reviewed",
  "selected",
  "stand_by",
  "rejected",
];

const ALL_RECOMMENDATIONS = "All recommendations";
const recommendations = Object.keys(RECOMMENDATION_LABELS) as ScreeningRecommendation[];

/** Screenings the backfill route queues again: none, stale, failed, skipped. */
const needsScreening = (status: string | undefined) =>
  status === undefined || status === "stale" || status === "failed" || status === "skipped_quota";

export default function ApplicantsTable({
  data,
  jobPostId,
  defaultSort,
  stages,
  rowSelection = {},
  onRowSelectionChange,
}: ApplicantsTableProps) {
  const router = useRouter();
  const { handle: handleEntitlement, dialog } = useEntitlementError();
  const [sorting, setSorting] = useState<SortingState>(
    defaultSort === "fit" ? [{ id: "fit", desc: true }] : [],
  );
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [page, setPage] = useState(1);
  const [screening, setScreening] = useState(false);
  const pageSize = 10;

  const jobTitles = useMemo(() => {
    const titles = data
      .map((item) => item.job_postings?.title)
      .filter(
        (title): title is string =>
          typeof title === "string" && title.length > 0,
      );
    return ["All Titles", ...new Set(titles)];
  }, [data]);

  const flatData = useMemo(() => {
    return data.map((item) => ({
      ...item,
      applicantName: item.user_info?.full_name || "",
      jobTitle: item.job_postings?.title || "",
    }));
  }, [data]);

  const unscreened = useMemo(
    () => data.filter((item) => needsScreening(item.application_screenings?.status)).length,
    [data],
  );

  const columns: ColumnDef<Row>[] = useMemo(() => {
    const stageName = new Map((stages ?? []).map((s) => [s.id, s.name]));
    const selectColumn: ColumnDef<Row> = {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all"
          checked={
            table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select ${row.original.applicantName || "applicant"}`}
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
        />
      ),
      enableSorting: false,
    };
    const stageColumn: ColumnDef<Row> = {
      id: "stage",
      accessorFn: (row) => row.stage_id ?? undefined,
      header: "Stage",
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap">
          {(row.original.stage_id && stageName.get(row.original.stage_id)) ?? "—"}
        </span>
      ),
      filterFn: "equals",
    };
    return [
      ...(stages ? [selectColumn] : []),
      {
        accessorKey: "applicantName",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Applicant Name
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="font-medium">
            {row.original.applicantName || "N/A"}
          </div>
        ),
        filterFn: "includesString",
      },
      {
        accessorKey: "jobTitle",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Job Title
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="text-sm ">
            <Link
              href={`/company/job-posts/${row.original.job_postings?.id}`}
              className="hover:underline underline underline-offset-4 sm:no-underline"
            >
              {row.original.jobTitle}
            </Link>
          </div>
        ),
        filterFn: "equals",
      },
      {
        id: "fit",
        // Unscored rows stay last in both directions.
        accessorFn: (row) => row.application_screenings?.fit_score ?? undefined,
        sortUndefined: "last",
        sortDescFirst: true,
        header: ({ column }) => (
          <Button variant="ghost" onClick={() => column.toggleSorting()}>
            Fit
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => {
          const s = row.original.application_screenings;
          if (isScreeningInProgress(s?.status as ScreeningStatus | undefined)) {
            return (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground whitespace-nowrap">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Screening…
              </span>
            );
          }
          if (s?.fit_score !== null && s?.fit_score !== undefined) {
            return <MatchScoreBadge score={s.fit_score} className="whitespace-nowrap" />;
          }
          return <span className="text-muted-foreground">—</span>;
        },
      },
      {
        id: "recommendation",
        accessorFn: (row) => row.application_screenings?.recommendation ?? undefined,
        filterFn: "equals",
        enableHiding: true,
      },
      {
        accessorKey: "status",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Status
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <ApplicationStatusBadge
            status={row.original.status as TApplicationStatus}
          />
        ),
        filterFn: "equals",
      },
      ...(stages ? [stageColumn] : []),
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Date Applied
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="text-sm ">
            {format(new Date(row.original.created_at), "PPP")}
          </div>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <Link href={`/company/applicants/${row.original.id}`}>
            <Button variant="ghost" size="sm">
              View Applicant
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        ),
      },
    ];
  }, [stages]);

  const table = useReactTable({
    data: flatData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
    enableRowSelection: !!stages,
    onRowSelectionChange: (updater) =>
      onRowSelectionChange?.(updater instanceof Function ? updater(rowSelection) : updater),
    onSortingChange: (updater) => {
      setSorting((old) =>
        updater instanceof Function ? updater(old) : updater,
      );
      setPage(1);
    },
    onColumnFiltersChange: (updater) => {
      setColumnFilters((old) =>
        updater instanceof Function ? updater(old) : updater,
      );
      setPage(1);
    },
    state: {
      sorting,
      columnFilters,
      columnVisibility: { recommendation: false },
      rowSelection,
    },
  });

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return table.getRowModel().rows.slice(start, start + pageSize);
  }, [table, page, pageSize, table.getRowModel().rows]);

  const totalRecords = table.getRowModel().rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  const clearFilters = () => {
    setColumnFilters([]);
    table.getColumn("applicantName")?.setFilterValue("");
    table.getColumn("jobTitle")?.setFilterValue(undefined);
    table.getColumn("status")?.setFilterValue(undefined);
    table.getColumn("recommendation")?.setFilterValue(undefined);
    table.getColumn("stage")?.setFilterValue(undefined);
  };

  const hasFilters = useMemo(() => {
    return columnFilters.length > 0;
  }, [columnFilters]);

  const screenUnscreened = async () => {
    if (!jobPostId) return;
    setScreening(true);
    try {
      const res = await fetch(`/api/company/job-posts/${jobPostId}/screen`, { method: "POST" });
      if (await handleEntitlement(res)) return;
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Couldn't queue the screenings. Please try again.");
        return;
      }
      const queued: number = body?.queued ?? 0;
      toast.success(`Queued ${queued} screening${queued === 1 ? "" : "s"}.`);
      router.refresh();
    } catch {
      toast.error("Couldn't queue the screenings. Please try again.");
    } finally {
      setScreening(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters Section */}
      <div className="flex items-center justify-between gap-4 flex-wrap ">
        <div className="flex items-center gap-4 overflow-x-auto p-1">
          <Input
            placeholder="Applicant Name"
            value={
              (table.getColumn("applicantName")?.getFilterValue() as string) ??
              ""
            }
            onChange={(event) =>
              table
                .getColumn("applicantName")
                ?.setFilterValue(event.target.value)
            }
            className="w-[150px] shrink-0 text-sm"
          />

          <Select
            onValueChange={(value) =>
              table
                .getColumn("jobTitle")
                ?.setFilterValue(value === "All Titles" ? undefined : value)
            }
            value={
              (table.getColumn("jobTitle")?.getFilterValue() as string) ??
              "All Titles"
            }
          >
            <SelectTrigger className="w-[180px]" aria-label="Filter by job title">
              <SelectValue placeholder="Filter by Job Title" />
            </SelectTrigger>
            <SelectContent>
              {jobTitles.map((title) => (
                <SelectItem key={title} value={title}>
                  {title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            onValueChange={(value) =>
              table
                .getColumn("status")
                ?.setFilterValue(value === "All Statuses" ? undefined : value)
            }
            value={
              (table.getColumn("status")?.getFilterValue() as string) ??
              "All Statuses"
            }
          >
            <SelectTrigger className="w-[180px]" aria-label="Filter by status">
              <SelectValue placeholder="Filter by Status" />
            </SelectTrigger>
            <SelectContent>
              {applicationStatuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            onValueChange={(value) =>
              table
                .getColumn("recommendation")
                ?.setFilterValue(value === ALL_RECOMMENDATIONS ? undefined : value)
            }
            value={
              (table.getColumn("recommendation")?.getFilterValue() as string) ??
              ALL_RECOMMENDATIONS
            }
          >
            <SelectTrigger className="w-[190px]" aria-label="Filter by recommendation">
              <SelectValue placeholder="Filter by recommendation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_RECOMMENDATIONS}>{ALL_RECOMMENDATIONS}</SelectItem>
              {recommendations.map((r) => (
                <SelectItem key={r} value={r}>
                  {RECOMMENDATION_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {stages && (
            <Select
              onValueChange={(value) =>
                table
                  .getColumn("stage")
                  ?.setFilterValue(value === ALL_STAGES ? undefined : value)
              }
              value={(table.getColumn("stage")?.getFilterValue() as string) ?? ALL_STAGES}
            >
              <SelectTrigger className="w-[160px]" aria-label="Filter by stage">
                <SelectValue placeholder="Filter by stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STAGES}>{ALL_STAGES}</SelectItem>
                {stages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <Button
              variant="ghost"
              onClick={clearFilters}
              className="text-muted-foreground"
            >
              <XCircle className="w-4 h-4 mr-2" />
              Clear Filters
            </Button>
          )}
          {jobPostId && unscreened > 0 && (
            <Button variant="brand" onClick={screenUnscreened} disabled={screening}>
              {screening && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Screen {unscreened} unscreened
            </Button>
          )}
        </div>
      </div>

      {/* Table Section */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {paginatedRows.length ? (
              paginatedRows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="h-24 text-center"
                >
                  No applicants found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="my-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground sm:text-sm">
        <div>
          Showing {paginatedRows.length ? (page - 1) * pageSize + 1 : 0}-
          {(page - 1) * pageSize + paginatedRows.length} of {totalRecords}{" "}
          applicants
        </div>
        <div className="flex min-w-0 max-w-full items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="min-w-0"
          >
            <span className="truncate">Previous</span>
          </Button>
          <span className="whitespace-nowrap">
            {/* "Page" is dropped on the narrowest phones so the footer fits. */}
            <span className="max-[400px]:hidden">Page </span>
            {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="min-w-0"
          >
            <span className="truncate">Next</span>
          </Button>
        </div>
      </div>
      {dialog}
    </div>
  );
}
