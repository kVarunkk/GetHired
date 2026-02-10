"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
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
// import Link from "next/link";
import { ArrowUpDown, ChevronRight, XCircle } from "lucide-react";
import { IJobPosting } from "@/lib/types";
import { Switch } from "./ui/switch";
import { useJobPostingStatus } from "@/lib/hooks/useJobPostingStatus";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link as ModifiedLink } from "react-transition-progress/next";

interface JobPostingsTableProps {
  data: IJobPost[];
}

export interface IJobPost
  extends Omit<IJobPosting, "applications" | "company_info"> {
  applications?: { count: number }[];
  company_info?: {
    name: string;
    website: string;
  };
}

export const JobStatusSwitch = ({ job }: { job: IJobPosting | IJobPost }) => {
  const { checkedState, handleUpdateStatus } = useJobPostingStatus(
    job.status,
    job
  );

  return (
    <div className="flex items-center">
      <Switch
        title={`${checkedState ? "Deactivate" : "Activate"}`}
        checked={checkedState}
        onCheckedChange={handleUpdateStatus}
      />
    </div>
  );
};

export default function JobPostingsTable({ data }: JobPostingsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<
    import("@tanstack/react-table").ColumnFiltersState
  >([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setPage(1);
  }, [columnFilters, sorting]);

  const jobTypes = useMemo(() => {
    const types = data.map((item) => item.job_type);

    return ["All Types", ...new Set(types)];
  }, [data]);

  const jobStatuses = useMemo(() => {
    return ["All Statuses", "active", "inactive"];
  }, []);

  const columns: ColumnDef<IJobPost>[] = useMemo(
    () => [
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <JobStatusSwitch job={row.original} />,
        filterFn: "equals",
      },
      {
        accessorKey: "title",
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
          <ModifiedLink
            href={`/company/job-posts/${row.original.id}`}
            className="font-medium hover:underline"
          >
            {row.original.title}
          </ModifiedLink>
        ),
        filterFn: "includesString",
      },
      {
        accessorKey: "location",
        header: "Location",
        cell: ({ row }) => (
          <div className="text-sm ">{row.original.location.join(", ")}</div>
        ),
      },
      {
        accessorKey: "job_type",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Job Type
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="text-sm ">{row.original.job_type}</div>
        ),
        filterFn: "equals",
      },
      {
        accessorKey: "applications",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Applicants
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="text-sm ">
            {row.original.applications
              ? row.original.applications[0]?.count
              : 0}
          </div>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <ModifiedLink href={`/company/job-posts/${row.original.id}`} passHref>
            <Button variant="ghost" size="sm">
              View Job
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </ModifiedLink>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: {
      sorting,
      columnFilters,
    },
  });

  const clearFilters = () => {
    setColumnFilters([]);
    setPage(1);
  };

  const hasFilters = useMemo(() => {
    return columnFilters.length > 0;
  }, [columnFilters]);
  // const getRowModelRows = table.getRowModel().rows;

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return table.getRowModel().rows.slice(start, start + pageSize);
  }, [page, pageSize, table, table.getRowModel().rows]);

  const totalRecords = table.getRowModel().rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  return (
    <div className="space-y-4">
      {/* Filters Section */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4 overflow-x-auto p-1">
          <Input
            placeholder="Job Title"
            value={(table.getColumn("title")?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
              table.getColumn("title")?.setFilterValue(event.target.value)
            }
            className="max-w-sm text-sm shrink-0 w-[150px]"
          />

          <Select
            onValueChange={(value) =>
              table
                .getColumn("job_type")
                ?.setFilterValue(value === "All Types" ? undefined : value)
            }
            value={
              (table.getColumn("job_type")?.getFilterValue() as string) ??
              "All Types"
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by Job Type" />
            </SelectTrigger>
            <SelectContent>
              {jobTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
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
              {jobStatuses.map((status) => (
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
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {paginatedRows?.length ? (
              paginatedRows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
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
                  No job postings found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between my-2 text-xs sm:text-sm text-muted-foreground">
        <div>
          Showing {paginatedRows.length ? (page - 1) * pageSize + 1 : 0}-
          {(page - 1) * pageSize + paginatedRows.length} of {totalRecords} job
          postings
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
