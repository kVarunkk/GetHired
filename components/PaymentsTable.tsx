"use client";

import { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/utils/date";
import { ChevronRight } from "lucide-react";
import ApplicationStatusBadge from "./ApplicationStatusBadge";
import DataTable, { SelectFilter, SortableHeader } from "./DataTable";
import { formatCurrency } from "@/utils/utils";
import { Link as ModifiedLink } from "react-transition-progress/next";
import { TPaymentsTableRecord } from "@/utils/types/payments.types";
import { TPaymentStatus } from "@/utils/types";

interface PaymentsTableProps {
  data: TPaymentsTableRecord[];
}

const paymentStatuses = [
  "complete",
  "failed",
  "pending",
  "cancelled",
];

const pricePlans = [
  "Trial Pack",
  "Standard Bundle",
  "Pro Bundle",
  "Power User",
];

export default function PaymentsTable({ data }: PaymentsTableProps) {
  const flatData = useMemo(() => {
    return data.map((item) => ({
      ...item,
      amount: `${(item.total_amount ?? 0 / 100).toFixed(2)} ${item.currency?.toUpperCase() ?? ""}`,
      plan: item.price_plan ? item.price_plan.name : "N/A",
      credits: item.credit_amount,
    }));
  }, [data]);

  const columns: ColumnDef<
    TPaymentsTableRecord & {
      amount: string;
      plan: string | null;
      credits: number | null;
    }
  >[] = useMemo(
    () => [
      {
        accessorKey: "created_at",
        header: ({ column }) => (
          <SortableHeader column={column} label="Date Purchased" />
        ),
        cell: ({ row }) => (
          <div className="text-sm ">
            {formatDate(row.original.created_at)}
          </div>
        ),
      },

      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <ApplicationStatusBadge
            status={row.original.status as TPaymentStatus}
          />
        ),
        filterFn: "equals",
      },
      {
        accessorKey: "amount",
        header: "Amount Paid",
        cell: ({ row }) => (
          <div className="text-sm font-medium">
            {formatCurrency(
              row.original.total_amount ?? 0,
              row.original.currency ?? "",
            )}
          </div>
        ),
      },
      {
        accessorKey: "credits",
        header: ({ column }) => (
          <SortableHeader column={column} label="Credits Purchased" />
        ),
        cell: ({ row }) => (
          <div className="text-sm font-medium ml-2">{row.original.credits}</div>
        ),
      },
      {
        accessorKey: "plan",
        header: "Plan",
        cell: ({ row }) => (
          <div
            className="max-w-[12rem] truncate text-sm font-medium"
            title={row.original.plan ?? undefined}
          >
            {row.original.plan}
          </div>
        ),
      },

      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <ModifiedLink
            prefetch={false}
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
    [],
  );

  return (
    <DataTable
      data={flatData}
      columns={columns}
      noun="purchases"
      filters={(table) => (
        <>
          <SelectFilter
            table={table}
            column="plan"
            allLabel="All Plans"
            options={pricePlans}
            label="Filter by plan"
          />
          <SelectFilter
            table={table}
            column="status"
            allLabel="All Statuses"
            options={paymentStatuses}
            label="Filter by status"
          />
        </>
      )}
    />
  );
}
