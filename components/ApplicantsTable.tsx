"use client";

import { useMemo, useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
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
// import { IApplication } from "@/utils/types";
import { ChevronRight, ArrowUpDown, XCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import ApplicationStatusBadge from "./ApplicationStatusBadge";
import { TApplicationServer } from "@/utils/types/application.types";
import { TApplicationStatus } from "@/utils/types";

interface ApplicantsTableProps {
  data: TApplicationServer[];
}

const applicationStatuses = [
  "All Statuses",
  "submitted",
  "reviewed",
  "selected",
  "stand_by",
  "rejected",
];

export default function ApplicantsTable({ data }: ApplicantsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<
    import("@tanstack/react-table").ColumnFiltersState
  >([]);
  const [page, setPage] = useState(1);
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

  const columns: ColumnDef<
    TApplicationServer & { applicantName: string; jobTitle: string }
  >[] = useMemo(
    () => [
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
    ],
    [],
  );

  const table = useReactTable({
    data: flatData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
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
    },
  });

  // const getRowModelRows = table.getRowModel().rows;

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
  };

  const hasFilters = useMemo(() => {
    return columnFilters.length > 0;
  }, [columnFilters]);

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
            <SelectTrigger className="w-[180px]">
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
            <SelectTrigger className="w-[180px]">
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
        </div>
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
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No applicants found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between my-2 text-xs sm:text-sm text-muted-foreground">
        <div>
          Showing {paginatedRows.length ? (page - 1) * pageSize + 1 : 0}-
          {(page - 1) * pageSize + paginatedRows.length} of {totalRecords}{" "}
          applicants
        </div>
        <div className="flex gap-2 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
