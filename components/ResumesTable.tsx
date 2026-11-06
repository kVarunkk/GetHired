"use client";

import { useMemo, useState } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/date";
import { ChevronRight } from "lucide-react";
import DataTable, { SortableHeader, TextFilter } from "./DataTable";
import { Badge } from "./ui/badge";
import ResumeSetPrimary from "./ResumeSetPrimary";
import { Link as ModifiedLink } from "react-transition-progress/next";
import InfoTooltip from "./InfoTooltip";
import { useRouter } from "next/navigation";
import { TResumeReviewResume } from "@/utils/types/review.types";
import ResumeStatusBadge from "./ResumeStatusBadge";
import ResumeRowActions from "./resume/ResumeRowActions";

export type TResumeTableRow = TResumeReviewResume & {
  schema_version: number;
  review_count: number;
  /** False when the file couldn't be read and there's nothing to edit (RE-REQ-098). */
  has_content: boolean;
};

interface ResumesTableProps {
  data: TResumeTableRow[];
}

export default function ResumesTable({ data }: ResumesTableProps) {
  const [items, setItems] = useState<TResumeTableRow[]>(data);
  const [isProcessing, setIsProcessing] = useState(false);
  const router = useRouter();

  const columns: ColumnDef<TResumeTableRow>[] = useMemo(
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
            {row.original.parsing_failed && row.original.has_content ? (
              // A failed resume with content still works; the file is only gone.
              <Badge variant="outline">Needs a new file</Badge>
            ) : row.original.parsing_failed ? (
              <ResumeStatusBadge isParsed={false} isParsingFailed={true} />
            ) : (
              row.original.schema_version === 1 && (
                <Badge variant="outline">Older format</Badge>
              )
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
          <ResumeRowActions
            resume={{
              id: row.original.id,
              name: row.original.name,
              reviewCount: row.original.review_count,
              // RE-REQ-098: nothing to edit, copy or export without content.
              isUnreadable: !row.original.has_content,
            }}
            canDelete={items.length > 1}
            onDeleted={(id) => {
              setItems((prev) => prev.filter((item) => item.id !== id));
              router.refresh();
            }}
          />
        ),
      },
    ],
    [isProcessing, items, router],
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
