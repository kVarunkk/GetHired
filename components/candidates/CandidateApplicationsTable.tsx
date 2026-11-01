"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable from "@/components/DataTable";
import { Badge } from "@/components/ui/badge";
import type { CandidateApplication } from "@/helpers/candidates/candidate-page";
import { formatDate } from "@/utils/date";

const columns: ColumnDef<CandidateApplication>[] = [
  {
    id: "job",
    header: "Job",
    cell: ({ row }) => (
      <Link
        href={`/company/applications/${row.original.id}`}
        className="font-medium [overflow-wrap:anywhere] hover:underline"
      >
        {row.original.jobTitle}
      </Link>
    ),
  },
  {
    id: "stage",
    header: "Stage",
    cell: ({ row }) => <Badge variant="outline">{row.original.stageName ?? "No stage"}</Badge>,
  },
  {
    id: "added",
    header: "Added",
    cell: ({ row }) => <span className="text-sm">{formatDate(row.original.createdAt) || "—"}</span>,
  },
];

/** A company candidate's applications with their stage (BI-REQ-004). */
export default function CandidateApplicationsTable({ applications }: { applications: CandidateApplication[] }) {
  return (
    <DataTable
      data={applications}
      columns={columns}
      noun="applications"
      aria-label="Applications"
      getRowId={(row) => row.id}
      emptyMessage="Not in any of your jobs yet."
    />
  );
}
