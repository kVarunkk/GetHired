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
import { format } from "date-fns";
import { ChevronRight, ArrowUpDown, XCircle } from "lucide-react";
import DynamicActions from "./DynamicTableActions";
import { Input } from "./ui/input";
import { Link as ModifiedLink } from "react-transition-progress/next";
import { useRouter } from "next/navigation";
import { TInterviewPageServer } from "@/utils/types/interview.types";
import Link from "next/link";

interface InterviewsTableProps {
  data: TInterviewPageServer[];
}

type TInterviewWithFlattenedFields = TInterviewPageServer & {
  resume_name: string;
  job_name: string;
};

export default function InterviewsTable({ data }: InterviewsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<
    import("@tanstack/react-table").ColumnFiltersState
  >([]);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<TInterviewPageServer[]>(data);
  const router = useRouter();

  const pageSize = 10;

  const updateLocalItem = (updatedItem: TInterviewPageServer) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
    );
    router.refresh();
  };

  const removeLocalItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    router.refresh();
  };

  const flattenedData = useMemo(() => {
    return items.map((item) => ({
      ...item,
      resume_name: item?.resumes?.name,
      job_name: item?.all_jobs?.job_name,
    }));
  }, [items]);

  const columns: ColumnDef<
    TInterviewPageServer & { resume_name: string; job_name: string }
  >[] = useMemo(
    () => [
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Created At
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="text-sm ">
            {format(new Date(row.original.created_at || ""), "PPP")}
          </div>
        ),
      },

      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <div className="text-sm font-medium">{row.original.name}</div>
          </div>
        ),
      },

      {
        accessorKey: "job_name",
        header: "Job",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <div className="text-sm font-medium">
              <Link
                className="underline"
                href={"/jobs/" + row.original.all_jobs?.id}
                target="_blank"
              >
                {row.original.all_jobs?.job_name}
              </Link>
            </div>
          </div>
        ),
      },

      {
        accessorKey: "resume_name",
        header: "Resume",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <div className="text-sm font-medium">
              <Link
                className="underline"
                href={"/resume/" + row.original.resumes?.id}
                target="_blank"
              >
                {row.original.resumes?.name}
              </Link>
            </div>
          </div>
        ),
      },

      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <ModifiedLink prefetch={false} href={`/interview/${row.original.id}`}>
            <Button variant="ghost" size="sm">
              View Interview
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </ModifiedLink>
        ),
      },
      {
        id: "actions2",
        header: "",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <DynamicActions
              tableName="interviews"
              entityName="Interview"
              item={row.original}
              fields={[
                {
                  name: "name",
                  label: "AI Interview Name",
                  required: true,
                },
              ]}
              selectString={
                "id, created_at, name, all_jobs(id, job_name), resumes(id, name)"
              }
              updateLocalItem={updateLocalItem}
              removeLocalItem={removeLocalItem}
            />
          </div>
        ),
      },
    ],
    [],
  );

  const table = useReactTable<TInterviewWithFlattenedFields>({
    data: flattenedData as unknown as TInterviewWithFlattenedFields[],
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

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return table.getRowModel().rows.slice(start, start + pageSize);
  }, [table, page, pageSize, table.getRowModel().rows]);

  const totalRecords = table.getRowModel().rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  const clearFilters = () => {
    setColumnFilters([]);
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
            placeholder="Interview Name"
            value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
              table.getColumn("name")?.setFilterValue(event.target.value)
            }
            className="w-[150px] shrink-0 text-sm"
          />
          <Input
            placeholder="Job Name"
            value={
              (table.getColumn("job_name")?.getFilterValue() as string) ?? ""
            }
            onChange={(event) =>
              table.getColumn("job_name")?.setFilterValue(event.target.value)
            }
            className="w-[150px] shrink-0 text-sm"
          />
          <Input
            placeholder="Resume Name"
            value={
              (table.getColumn("resume_name")?.getFilterValue() as string) ?? ""
            }
            onChange={(event) =>
              table.getColumn("resume_name")?.setFilterValue(event.target.value)
            }
            className="w-[150px] shrink-0 text-sm"
          />
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
                  No Interviews found.
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
          interviews
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
