"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { QUESTION_SETS_PATH } from "@/helpers/jobs/question-sets";

export type QuestionSetRow = { id: string; name: string; questionCount: number; updatedAt: string };

const COLUMNS: ColumnDef<QuestionSetRow>[] = [
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link
        href={`${QUESTION_SETS_PATH}/${row.original.id}`}
        className="block max-w-80 truncate font-medium underline-offset-4 hover:text-brand hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: "questions",
    header: "Questions",
    cell: ({ row }) => {
      const count = row.original.questionCount;
      return `${count} question${count === 1 ? "" : "s"}`;
    },
    meta: { className: "text-muted-foreground" },
  },
  {
    id: "updated",
    header: "Updated",
    cell: ({ row }) => new Date(row.original.updatedAt).toLocaleDateString(undefined, { dateStyle: "medium" }),
    meta: { className: "text-muted-foreground" },
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex items-center justify-end">
        <Button asChild variant="ghost" size="sm">
          <Link href={`${QUESTION_SETS_PATH}/${row.original.id}`}>View</Link>
        </Button>
      </div>
    ),
  },
];

/** Settings → Question sets (AF-REQ-004). */
export default function QuestionSetsTable({ sets, canManage }: { sets: QuestionSetRow[]; canManage: boolean }) {
  return (
    <DataTable
      aria-label="Question sets"
      data={sets}
      columns={COLUMNS}
      noun="question sets"
      emptyMessage={
        canManage
          ? "No question sets yet. Create one to reuse the same questions and knockout rules across jobs."
          : "No question sets yet."
      }
      getRowId={(set) => set.id}
    />
  );
}
