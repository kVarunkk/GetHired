"use client";

import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/date";
import { ChevronRight } from "lucide-react";
import DataTable, { SortableHeader, TextFilter } from "./DataTable";
import DynamicActions from "./DynamicTableActions";
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
  const [items, setItems] = useState<TInterviewPageServer[]>(data);
  const router = useRouter();

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
          <SortableHeader column={column} label="Created At" />
        ),
        cell: ({ row }) => (
          <div className="text-sm ">
            {formatDate(row.original.created_at)}
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
        accessorKey: "job_name",
        header: "Job",
        cell: ({ row }) => (
          <Link
            className="block max-w-[16rem] truncate text-sm font-medium underline"
            href={"/jobs/" + row.original.all_jobs?.id}
            target="_blank"
            title={row.original.all_jobs?.job_name ?? undefined}
          >
            {row.original.all_jobs?.job_name}
          </Link>
        ),
      },

      {
        accessorKey: "resume_name",
        header: "Resume",
        cell: ({ row }) => (
          <Link
            className="block max-w-[14rem] truncate text-sm font-medium underline"
            href={"/resume/" + row.original.resumes?.id}
            target="_blank"
            title={row.original.resumes?.name ?? undefined}
          >
            {row.original.resumes?.name}
          </Link>
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

  return (
    <DataTable
      data={flattenedData as unknown as TInterviewWithFlattenedFields[]}
      columns={columns}
      noun="interviews"
      filters={(table) => (
        <>
          <TextFilter table={table} column="name" placeholder="Interview Name" />
          <TextFilter table={table} column="job_name" placeholder="Job Name" />
          <TextFilter table={table} column="resume_name" placeholder="Resume Name" />
        </>
      )}
    />
  );
}
