"use client";

import { Badge, BadgeProps } from "./ui/badge";
import { useMemo } from "react";
import { cn } from "@/utils/utils";
import {
  TApplicationStatus,
  TPaymentStatus,
  TResumeReviewStatus,
} from "@/utils/types";

export default function ApplicationStatusBadge({
  status,
}: {
  status: TApplicationStatus | TPaymentStatus | TResumeReviewStatus;
}) {
  const style = useMemo((): {
    variant: BadgeProps["variant"];
    className?: string;
  } => {
    switch (status) {
      case "submitted":
      case "pending":
      case "draft":
        return { variant: "secondary" };
      case "reviewed":
      case "cancelled":
        return { variant: "warning" };
      case "selected":
      case "complete":
      case "completed":
        return { variant: "success" };
      case "stand_by":
        return { variant: "outline", className: "text-muted-foreground" };
      case "rejected":
      case "failed":
        return {
          variant: "outline",
          className: "border-destructive/30 bg-destructive/10 text-destructive",
        };
      default:
        return { variant: "secondary" };
    }
  }, [status]);

  return (
    <Badge
      variant={style.variant}
      className={cn("capitalize w-fit", style.className)}
    >
      {status}
    </Badge>
  );
}
