import { Badge } from "@/components/ui/badge";
import type { OutreachStatus } from "@/utils/types/outreach.types";
import { cn } from "@/utils/utils";

type Variant = "brand" | "success" | "warning" | "outline" | "secondary";

export const OUTREACH_STATUS_LABELS: Record<OutreachStatus, { label: string; variant: Variant }> = {
  sent: { label: "Contacted", variant: "brand" },
  interested: { label: "Interested", variant: "success" },
  not_interested: { label: "Not interested", variant: "secondary" },
  expired: { label: "No reply", variant: "outline" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
  reported: { label: "Reported", variant: "warning" },
};

/** The company's latest outreach to a candidate (OR-REQ-007). Nothing without one. */
export default function OutreachStatusBadge({
  status,
  className,
}: {
  status: OutreachStatus | null | undefined;
  className?: string;
}) {
  if (!status) return null;
  const { label, variant } = OUTREACH_STATUS_LABELS[status];
  return (
    <Badge variant={variant} className={cn("text-xs", className)} data-status={status}>
      {label}
    </Badge>
  );
}
