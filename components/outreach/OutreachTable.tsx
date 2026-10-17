"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Column,
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUpDown, XCircle } from "lucide-react";
import OutreachStatusBadge, { OUTREACH_STATUS_LABELS } from "@/components/outreach/OutreachStatusBadge";
import WithdrawOutreachButton from "@/components/outreach/WithdrawOutreachButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OUTREACH_STATUSES, outreachPath } from "@/helpers/outreach/config";
import type { CompanyOutreachItem } from "@/helpers/outreach/list";
import type { OutreachStatus } from "@/utils/types/outreach.types";
import MemberAvatar from "@/components/team/MemberAvatar";

const ALL_JOBS = "All Jobs";
const ALL_STATUSES = "All Statuses";

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

function SortHeader({ column, label }: { column: Column<CompanyOutreachItem>; label: string }) {
  return (
    <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
      {label}
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  );
}

/**
 * The company's outreach (OR-REQ-007), laid out like the app's other tables.
 * The job and status filters live in the URL because the server pages and the
 * reply rate follow them; the candidate search filters the loaded page.
 */
export default function OutreachTable({
  items,
  jobs,
  jobPostId,
  status,
  cursor,
  nextCursor,
}: {
  items: CompanyOutreachItem[];
  jobs: { id: string; title: string }[];
  jobPostId: string | null;
  status: OutreachStatus | null;
  cursor: string | null;
  nextCursor: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const navigate = (next: { job?: string | null; status?: string | null; cursor?: string | null }) => {
    const params = new URLSearchParams();
    const job = next.job === undefined ? jobPostId : next.job;
    const nextStatus = next.status === undefined ? status : next.status;
    if (job) params.set("job", job);
    if (nextStatus) params.set("status", nextStatus);
    if (next.cursor) params.set("cursor", next.cursor);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const columns: ColumnDef<CompanyOutreachItem>[] = useMemo(
    () => [
      {
        id: "candidate",
        accessorFn: (row) => row.candidateName ?? "Candidate",
        header: ({ column }) => <SortHeader column={column} label="Candidate" />,
        cell: ({ row }) => (
          <div className="max-w-xs">
            <Link
              href={`/company/profiles/${row.original.candidateUserId}`}
              className="block truncate font-medium hover:underline"
            >
              {row.original.candidateName ?? "Candidate"}
            </Link>
            <Link
              href={outreachPath(row.original.id)}
              className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
              title={row.original.subject ?? undefined}
            >
              {row.original.subject}
            </Link>
          </div>
        ),
        filterFn: "includesString",
      },
      {
        accessorKey: "jobTitle",
        header: "Job",
        cell: ({ row }) => (
          <div className="max-w-[16rem] truncate text-sm" title={row.original.jobTitle ?? undefined}>
            {row.original.jobTitle ?? "—"}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <OutreachStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "sentAt",
        header: ({ column }) => <SortHeader column={column} label="Sent" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2 text-sm">
            {/* TM-REQ-008: who sent it, as stored at send time. */}
            {row.original.senderName && <MemberAvatar name={row.original.senderName} className="h-6 w-6" />}
            <div className="min-w-0 max-w-[10rem]">
              <div>{formatDate(row.original.sentAt)}</div>
              {row.original.senderName && (
                <div className="truncate text-xs text-muted-foreground" title={row.original.senderName}>
                  by {row.original.senderName}
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        id: "respondedAt",
        accessorFn: (row) => row.respondedAt ?? "",
        header: ({ column }) => <SortHeader column={column} label="Responded" />,
        cell: ({ row }) => <div className="text-sm">{formatDate(row.original.respondedAt)}</div>,
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button asChild size="sm" variant="ghost">
              <Link href={outreachPath(row.original.id)}>View</Link>
            </Button>
            {row.original.status === "sent" && <WithdrawOutreachButton outreachId={row.original.id} />}
          </div>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: { sorting, columnFilters },
  });

  const hasFilters = columnFilters.length > 0 || jobPostId !== null || status !== null;
  const clearFilters = () => {
    setColumnFilters([]);
    if (jobPostId || status || cursor) navigate({ job: null, status: null, cursor: null });
  };

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-4">
      {/* Filters Section */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 overflow-x-auto p-1">
          <Input
            placeholder="Candidate"
            aria-label="Filter by candidate"
            value={(table.getColumn("candidate")?.getFilterValue() as string) ?? ""}
            onChange={(event) => table.getColumn("candidate")?.setFilterValue(event.target.value)}
            className="w-[150px] shrink-0 text-sm"
          />

          <Select
            onValueChange={(value) => navigate({ job: value === ALL_JOBS ? null : value, cursor: null })}
            value={jobPostId ?? ALL_JOBS}
          >
            <SelectTrigger className="w-[180px]" aria-label="Filter by job">
              <SelectValue placeholder="Filter by Job" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_JOBS}>{ALL_JOBS}</SelectItem>
              {jobs.map((job) => (
                <SelectItem key={job.id} value={job.id}>
                  {job.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            onValueChange={(value) => navigate({ status: value === ALL_STATUSES ? null : value, cursor: null })}
            value={status ?? ALL_STATUSES}
          >
            <SelectTrigger className="w-[180px]" aria-label="Filter by status">
              <SelectValue placeholder="Filter by Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>{ALL_STATUSES}</SelectItem>
              {OUTREACH_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {OUTREACH_STATUS_LABELS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters} className="text-muted-foreground">
            <XCircle className="w-4 h-4 mr-2" />
            Clear Filters
          </Button>
        )}
      </div>

      {/* Table Section */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {hasFilters || cursor ? (
                    "No outreach found."
                  ) : (
                    <>
                      No outreach yet. Find candidates in{" "}
                      <Link href="/company/profiles" className="underline hover:text-brand">
                        Profiles
                      </Link>{" "}
                      and choose Reach out.
                    </>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="my-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground sm:text-sm">
        <div>
          Showing {rows.length} {rows.length === 1 ? "message" : "messages"}
        </div>
        <div className="flex min-w-0 max-w-full items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ cursor: null })}
            disabled={!cursor}
            className="min-w-0"
          >
            <span className="truncate">Newest</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ cursor: nextCursor })}
            disabled={!nextCursor}
            className="min-w-0"
          >
            <span className="truncate">Older</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
