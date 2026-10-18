"use client";

import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ChevronRight } from "lucide-react";
import ApplicationStatusBadge from "./ApplicationStatusBadge";
import DataTable, { SelectFilter, SortableHeader, TextFilter } from "./DataTable";
import DynamicActions from "./DynamicTableActions";
import { Link as ModifiedLink } from "react-transition-progress/next";
import { useRouter } from "next/navigation";
import { TResumeReviewTable } from "@/utils/types/review.types";
import { TResumeReviewStatus } from "@/utils/types";

interface ResumeReviewsTableProps {
  data: TResumeReviewTable[];
}

export type TResumeReviewTableData = TResumeReviewTable & {
  resume: string;
  job: string;
};

const reviewStatuses = ["completed", "failed", "draft"];

export default function ResumeReviewsTable({ data }: ResumeReviewsTableProps) {
  const [items, setItems] = useState(data);
  const router = useRouter();

  const updateLocalItem = (updatedItem: TResumeReviewTable) => {
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
      resume: item?.resumes?.name,
      job: item?.all_jobs?.job_name,
    }));
  }, [items]);

  const columns: ColumnDef<
    TResumeReviewTable & { resume: string; job: string }
  >[] = useMemo(
    () => [
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <SortableHeader column={column} label="Created At" />
        ),
        cell: ({ row }) => (
          <div className="text-sm ">
            {format(new Date(row.original.created_at), "d MMM yyyy")}
          </div>
        ),
      },
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div
            className="max-w-[14rem] truncate text-sm font-medium"
            title={row.original.name ?? undefined}
          >
            {row.original.name}
          </div>
        ),
      },

      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <ApplicationStatusBadge
            status={row.original.status as TResumeReviewStatus}
          />
        ),
        filterFn: "equals",
      },

      {
        accessorKey: "resume",
        header: "Resume",
        cell: ({ row }) => (
          <div
            className="max-w-[14rem] truncate text-sm font-medium"
            title={row.original.resume}
          >
            {row.original.resume}
          </div>
        ),
      },

      {
        accessorKey: "job",
        header: "Job Name",
        cell: ({ row }) => (
          <div
            className="max-w-[16rem] truncate text-sm font-medium"
            title={row.original.job}
          >
            {row.original.job}
          </div>
        ),
      },

      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <ModifiedLink
            prefetch={false}
            href={`/resume-review/${row.original.id}`}
          >
            <Button variant="ghost" size="sm">
              View Review
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
              tableName="resume_reviews"
              entityName="CV Review"
              item={row.original}
              fields={[
                {
                  name: "name",
                  label: "Review Display Name",
                  required: true,
                },
              ]}
              selectString={
                "id, created_at, resumes(name), status, job_id, name"
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

  return (
    <DataTable
      data={flattenedData as unknown as TResumeReviewTableData[]}
      columns={columns}
      noun="reviews"
      filters={(table) => (
        <>
          <TextFilter table={table} column="name" placeholder="Review Name" />
          <SelectFilter
            table={table}
            column="status"
            allLabel="All Statuses"
            options={reviewStatuses}
            label="Filter by status"
          />
        </>
      )}
    />
  );
}
