"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { IBookmark } from "@/lib/types";
import { ArrowUpDown, ExternalLink, XCircle } from "lucide-react";
import AlertStatusSwitch from "./AlertStatusSwitch";
import InfoTooltip from "./InfoTooltip";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DynamicActions from "./DynamicTableActions";

interface JobsBookmarkTableProps {
  data: IBookmark[];
}

export default function JobsBookmarkTable({ data }: JobsBookmarkTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<
    import("@tanstack/react-table").ColumnFiltersState
  >([]);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<IBookmark[]>(data);

  const pageSize = 10;
  const alertCount = data.filter((each) => each.is_alert_on).length;

  useEffect(() => {
    setItems(data);
  }, [data]);

  useEffect(() => {
    setPage(1);
  }, [columnFilters, sorting]);

  const alertStatuses = useMemo(
    () => [
      { title: "All", value: "all" },
      { title: "Active", value: "true" },
      { title: "Disabled", value: "false" },
    ],
    []
  );

  const updateLocalItem = useCallback(
    (updatedItem: IBookmark) => {
      setItems((prev) =>
        prev.map((item) => (item.id === updatedItem.id ? updatedItem : item))
      );
    },
    [setItems]
  );

  const removeLocalItem = useCallback(
    (id: string) => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [setItems]
  );

  const columns: ColumnDef<IBookmark>[] = useMemo(
    () => [
      {
        accessorKey: "is_alert_on",
        header: () => (
          <div className="flex items-center">
            Alert
            <InfoTooltip
              content={
                "You will receive weekly update of the latest jobs for the bookmark on your email."
              }
            />
          </div>
        ),
        cell: ({ row }) => (
          <AlertStatusSwitch
            bookmark={row.original}
            updateLocalItem={updateLocalItem}
            alertCount={alertCount}
          />
        ),
        filterFn: "equals",
        size: 100,
      },
      {
        accessorKey: "name",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Name
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <Link
            href={row.original.url}
            target="_blank"
            className="font-medium hover:underline flex items-center"
            title={row.original.name}
          >
            <div className="truncate">{row.original.name}</div>{" "}
            <ExternalLink className="shrink-0 h-4 w-4" />
          </Link>
        ),
        size: 170,
      },

      {
        accessorKey: "url",
        header: "URL",
        cell: ({ row }) => (
          <div className="flex items-center ">
            <div className="text-sm  truncate" title={row.original.url}>
              {row.original.url}
            </div>
            <InfoTooltip content={row.original.url} />
          </div>
        ),
        filterFn: "includesString",
        size: 350,
      },

      {
        id: "actions2",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <DynamicActions
              tableName="bookmarks"
              entityName="Bookmark"
              item={row.original}
              fields={[
                {
                  name: "name",
                  label: "Name",
                  required: true,
                },
                {
                  name: "url",
                  label: "URL",
                  required: true,
                },
              ]}
              updateLocalItem={updateLocalItem}
              removeLocalItem={removeLocalItem}
            />
          </div>
        ),
      },
    ],
    [removeLocalItem, updateLocalItem, alertCount]
  );

  const table = useReactTable({
    data: items,
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

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return table.getRowModel().rows.slice(start, start + pageSize);
  }, [table, page, pageSize, table.getRowModel().rows]);

  const totalRecords = table.getRowModel().rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  const clearFilters = () => {
    setColumnFilters([]);
    table.getColumn("name")?.setFilterValue("");
    // table.getColumn("jobTitle")?.setFilterValue(undefined);
    table.getColumn("is_alert_on")?.setFilterValue(undefined);
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
            placeholder="Bookmark Name"
            value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
              table.getColumn("name")?.setFilterValue(event.target.value)
            }
            className="w-[160px] shrink-0 text-sm"
          />

          <Select
            onValueChange={(val) => {
              const filterValue =
                val === "true" ? true : val === "false" ? false : undefined;
              table.getColumn("is_alert_on")?.setFilterValue(filterValue);
            }}
            value={
              table.getColumn("is_alert_on")?.getFilterValue()?.toString() ??
              "all"
            }
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Filter by Alert Status" />
            </SelectTrigger>
            <SelectContent>
              {alertStatuses.map(({ title, value }) => (
                <SelectItem key={title} value={String(value)}>
                  {title}
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
        <Table className="table-fixed">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className="px-6"
                  >
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
                    <TableCell
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className="px-6"
                    >
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
                  No bookmarks found.
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
          bookmarks
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
