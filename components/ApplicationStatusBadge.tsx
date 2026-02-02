"use client";

import { Badge } from "./ui/badge";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  TApplicationStatus,
  TPaymentStatus,
  TResumeReviewStatus,
} from "@/lib/types";

export default function ApplicationStatusBadge({
  status,
}: {
  status: TApplicationStatus | TPaymentStatus | TResumeReviewStatus;
}) {
  const badgeColorClass = useMemo(() => {
    switch (status) {
      case "submitted":
      case "pending":
      case "draft":
        return "bg-slate-500 hover:bg-slate-500/80 text-white";
      case "reviewed":
      case "cancelled":
        return "bg-amber-500 hover:bg-amber-500/80 text-white";
      case "selected":
      case "complete":
      case "completed":
        return "bg-green-500 hover:bg-green-500/80 text-white";
      case "stand_by":
        return "bg-blue-500 hover:bg-blue-500/80 text-white";
      case "rejected":
      case "failed":
        return "bg-red-500 hover:bg-red-500/80 text-white";
      default:
        return "bg-gray-500 hover:bg-gray-500/80 text-white";
    }
  }, [status]);

  return (
    <Badge
      variant="secondary"
      className={cn("capitalize w-fit", badgeColorClass)}
    >
      {status}
    </Badge>
  );
}
