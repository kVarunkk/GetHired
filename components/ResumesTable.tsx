"use client";

import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/date";
import { ChevronRight } from "lucide-react";
import DataTable, { SortableHeader, TextFilter } from "./DataTable";
import DynamicActions from "./DynamicTableActions";
import { Badge } from "./ui/badge";
import ResumeSetPrimary from "./ResumeSetPrimary";
import { Link as ModifiedLink } from "react-transition-progress/next";
import InfoTooltip from "./InfoTooltip";
import { useRouter } from "next/navigation";
import { TResumeReviewResume } from "@/utils/types/review.types";
import ResumeStatusBadge from "./ResumeStatusBadge";

interface ResumesTableProps {
  data: TResumeReviewResume[];
}

export default function ResumesTable({ data }: ResumesTableProps) {
  const [items, setItems] = useState<TResumeReviewResume[]>(data);
  const [isProcessing, setIsProcessing] = useState(false);
  const router = useRouter();

  const updateLocalItem = (updatedItem: TResumeReviewResume) => {
    setItems((prev) =>
      prev.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
    );
    router.refresh();
  };

  const removeLocalItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    router.refresh();
  };

  const columns: ColumnDef<TResumeReviewResume>[] = useMemo(
    () => [
      {
        accessorKey: "is_primary",
        header: "Primary",
        cell: ({ row }) => {
          const isPrimary = !!row.original.is_primary;

          return (
            <ResumeSetPrimary
              isPrimary={isPrimary}
              isProcessing={isProcessing}
              setIsProcessing={setIsProcessing}
              items={items}
              setItems={setItems}
              resumeId={row.original.id}
            />
          );
        },
      },
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
          <div className="flex items-center gap-1">
            <div
              className="max-w-[16rem] truncate text-sm font-medium"
              title={row.original.name ?? undefined}
            >
              {row.original.name}
            </div>
            {row.original.is_primary && <Badge>PRIMARY</Badge>}
            {row.original.is_primary && (
              <InfoTooltip
                content={
                  <p>
                    This resume will be used for building your job digest and ai
                    smart search job feed.
                  </p>
                }
              />
            )}
            {row.original.parsing_failed && (
              <ResumeStatusBadge isParsed={false} isParsingFailed={true} />
            )}
          </div>
        ),
      },

      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <ModifiedLink prefetch={false} href={`/resume/${row.original.id}`}>
            <Button variant="ghost" size="sm">
              View Resume
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
              tableName="resumes"
              entityName="Resume"
              item={row.original}
              fields={[
                {
                  name: "name",
                  label: "Resume Display Name",
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
    [isProcessing, items],
  );

  return (
    <DataTable
      data={items}
      columns={columns}
      noun="resumes"
      filters={(table) => (
        <TextFilter table={table} column="name" placeholder="Resume Name" />
      )}
    />
  );
}
