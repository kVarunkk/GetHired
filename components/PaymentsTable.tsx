"use client";

import { useEffect, useMemo, useState } from "react";
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
// import Link from "next/link";
import { format } from "date-fns";
import { IPayment } from "@/lib/types";
import { ChevronRight, ArrowUpDown, XCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ApplicationStatusBadge from "./ApplicationStatusBadge";
import { formatCurrency } from "@/lib/utils";
import { Link as ModifiedLink } from "react-transition-progress/next";

interface PaymentsTableProps {
  data: IPayment[];
}

export default function PaymentsTable({ data }: PaymentsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<
    import("@tanstack/react-table").ColumnFiltersState
  >([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    setPage(1);
  }, [columnFilters, sorting]);

  const flatData = useMemo(() => {
    return data.map((item) => ({
      ...item,
      amount: `${(item.total_amount / 100).toFixed(2)} ${item.currency?.toUpperCase() ?? ""}`,
      plan: item.price_plan ? item.price_plan.name : "N/A",
      credits: item.credit_amount,
    }));
  }, [data]);

  const paymentStatuses = useMemo(() => {
    const statuses = [
      "All Statuses",
      "complete",
      "failed",
      "pending",
      "cancelled",
    ];
    return [...new Set(statuses)];
  }, []);

  const pricePlans = useMemo(() => {
    const plans = [
      "All Plans",
      "Trial Pack",
      "Standard Bundle",
      "Pro Bundle",
      "Power User",
    ];
    return [...new Set(plans)];
  }, []);

  const columns: ColumnDef<
    IPayment & { amount: string; plan: string; credits: number }
  >[] = useMemo(
    () => [
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Date Purchased
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
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <ApplicationStatusBadge status={row.original.status} />
        ),
        filterFn: "equals",
      },
      {
        accessorKey: "amount",
        header: "Amount Paid",
        cell: ({ row }) => (
          <div className="text-sm font-medium">
            {formatCurrency(row.original.total_amount, row.original.currency)}
          </div>
        ),
      },
      {
        accessorKey: "credits",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Credits Purchased
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="text-sm font-medium ml-2">{row.original.credits}</div>
        ),
      },
      {
        accessorKey: "plan",
        header: "Plan",
        cell: ({ row }) => (
          <div className="text-sm font-medium">{row.original.plan}</div>
        ),
      },

      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <ModifiedLink
            href={`/dashboard/buy-credits/payments/${row.original.id}`}
          >
            <Button variant="ghost" size="sm">
              View Purchase
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </ModifiedLink>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: flatData,
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

  // const getRowModelRows = table.getRowModel().rows;

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return table.getRowModel().rows.slice(start, start + pageSize);
  }, [table, page, pageSize, table.getRowModel().rows]);

  const totalRecords = table.getRowModel().rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  const clearFilters = () => {
    setColumnFilters([]);
    // table.getColumn("applicantName")?.setFilterValue("");
    // table.getColumn("jobTitle")?.setFilterValue(undefined);
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
          <Select
            onValueChange={(value) =>
              table
                .getColumn("plan")
                ?.setFilterValue(value === "All Plans" ? undefined : value)
            }
            value={
              (table.getColumn("plan")?.getFilterValue() as string) ??
              "All Plans"
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by Plans" />
            </SelectTrigger>
            <SelectContent>
              {pricePlans.map((title) => (
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
              {paymentStatuses.map((status) => (
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
                  No purchases found.
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
          purchases
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
